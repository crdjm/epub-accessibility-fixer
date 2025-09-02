import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs-extra';
import { ValidationIssue, ProcessingContext } from '../types';
import { Logger } from '../utils/common';
import { ToolInfo } from '../core/tool-installer';

const execAsync = promisify(exec);

export interface EpubCheckResult {
    valid: boolean;
    issues: ValidationIssue[];
    warningCount: number;
    errorCount: number;
    outputFile?: string;
}

export class ValidationRunner {
    private logger: Logger;
    private epubCheckPath?: string;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    setEpubCheckPath(toolInfo: ToolInfo): void {
        if (toolInfo.installed && toolInfo.path) {
            this.epubCheckPath = toolInfo.path;
        } else {
            throw new Error('EpubCheck is not installed or path is not available');
        }
    }

    async validateEpub(epubPath: string, keepOutput: boolean = false): Promise<EpubCheckResult> {
        if (!this.epubCheckPath) {
            throw new Error('EpubCheck path not set. Call setEpubCheckPath first.');
        }

        this.logger.info(`Running EPUB validation on ${epubPath}`);

        try {
            // Create temporary output file for JSON results
            const timestamp = Date.now();
            const inputBasename = path.basename(epubPath, '.epub');
            const inputDir = path.dirname(epubPath);

            const outputPath = keepOutput
                ? path.join(inputDir, `${inputBasename}_epubcheck_${timestamp}.json`)
                : path.join(path.dirname(epubPath), `validation-${timestamp}.json`);

            // Run epubcheck with JSON output
            const command = `java -jar "${this.epubCheckPath}" "${epubPath}" --json "${outputPath}"`;

            let stdout = '';
            let stderr = '';

            try {
                const result = await execAsync(command, {
                    maxBuffer: 1024 * 1024 * 10, // 10MB buffer
                    timeout: 300000 // 5 minute timeout
                });
                stdout = result.stdout;
                stderr = result.stderr;
            } catch (error: any) {
                // EpubCheck returns non-zero exit code for invalid EPUBs
                stdout = error.stdout || '';
                stderr = error.stderr || '';
            }

            // Parse JSON output if available
            let issues: ValidationIssue[] = [];
            let valid = true;
            let warningCount = 0;
            let errorCount = 0;

            if (await fs.pathExists(outputPath)) {
                try {
                    const jsonResult = await fs.readJson(outputPath);
                    const parseResult = this.parseEpubCheckJson(jsonResult);
                    issues = parseResult.issues;
                    valid = parseResult.valid;
                    warningCount = parseResult.warningCount;
                    errorCount = parseResult.errorCount;
                } catch (error) {
                    this.logger.warn(`Failed to parse EpubCheck JSON output: ${error}`);
                    // Fall back to parsing text output
                    const parseResult = this.parseEpubCheckText(stdout + stderr);
                    issues = parseResult.issues;
                    valid = parseResult.valid;
                    warningCount = parseResult.warningCount;
                    errorCount = parseResult.errorCount;
                }

                // Clean up temporary file only if not keeping output
                if (!keepOutput) {
                    await fs.remove(outputPath);
                } else {
                    this.logger.info(`EpubCheck output saved: ${outputPath}`);
                }
            } else {
                // Parse text output
                const parseResult = this.parseEpubCheckText(stdout + stderr);
                issues = parseResult.issues;
                valid = parseResult.valid;
                warningCount = parseResult.warningCount;
                errorCount = parseResult.errorCount;
            }

            this.logger.info(`Validation complete: ${errorCount} errors, ${warningCount} warnings`);

            return {
                valid,
                issues,
                warningCount,
                errorCount,
                outputFile: keepOutput ? outputPath : undefined
            };

        } catch (error) {
            this.logger.error(`EpubCheck validation failed: ${error}`);
            throw error;
        }
    }

    private parseEpubCheckJson(jsonResult: any): EpubCheckResult {
        const issues: ValidationIssue[] = [];
        let warningCount = 0;
        let errorCount = 0;

        if (jsonResult.messages) {
            this.logger.info(`Parsing ${jsonResult.messages.length} EpubCheck messages`);
            for (const message of jsonResult.messages) {
                const severity = this.mapSeverity(message.severity);
                const issue: ValidationIssue = {
                    type: message.severity === 'ERROR' ? 'error' :
                        message.severity === 'WARNING' ? 'warning' : 'info',
                    category: 'validation',
                    severity,
                    code: message.ID || 'UNKNOWN', // Use 'ID' field from EpubCheck JSON
                    message: message.message || 'Unknown validation issue',
                    location: {
                        file: message.locations?.[0]?.path,
                        line: message.locations?.[0]?.line,
                        column: message.locations?.[0]?.column
                    },
                    fixable: this.isFixable(message.ID), // Use 'ID' field here too
                    details: message.suggestion
                };

                this.logger.info(`Parsed EpubCheck issue: code="${issue.code}", message="${issue.message}", fixable=${issue.fixable}`);
                
                issues.push(issue);

                if (issue.type === 'error') {
                    errorCount++;
                } else if (issue.type === 'warning') {
                    warningCount++;
                }
            }
        }

        const valid = errorCount === 0;

        return {
            valid,
            issues,
            warningCount,
            errorCount
        };
    }

    private parseEpubCheckText(output: string): EpubCheckResult {
        const issues: ValidationIssue[] = [];
        const lines = output.split('\n');
        let warningCount = 0;
        let errorCount = 0;

        this.logger.info(`Parsing EpubCheck text output with ${lines.length} lines`);
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Parse standard epubcheck output format
            // Format: LEVEL(CODE): message at file(line,column)
            const match = trimmed.match(/^(ERROR|WARNING|INFO)\s*\(([^)]+)\):\s*(.+?)(?:\s+at\s+(.+?)(?:\((\d+),(\d+)\))?)?$/);

            if (match) {
                const [, level, code, message, file, line, column] = match;

                const issue: ValidationIssue = {
                    type: level.toLowerCase() as 'error' | 'warning' | 'info',
                    category: 'validation',
                    severity: this.mapSeverity(level),
                    code: code || 'UNKNOWN',
                    message: message || 'Unknown validation issue',
                    location: {
                        file: file,
                        line: line ? parseInt(line) : undefined,
                        column: column ? parseInt(column) : undefined
                    },
                    fixable: this.isFixable(code)
                };

                this.logger.info(`Parsed EpubCheck text issue: code="${issue.code}", message="${issue.message}", fixable=${issue.fixable}`);
                
                issues.push(issue);

                if (issue.type === 'error') {
                    errorCount++;
                } else if (issue.type === 'warning') {
                    warningCount++;
                }
            }
        }

        // Look for summary line
        const summaryMatch = output.match(/Check finished with (\d+) error\(s\), (\d+) warning\(s\)/);
        if (summaryMatch) {
            errorCount = parseInt(summaryMatch[1]);
            warningCount = parseInt(summaryMatch[2]);
        }

        const valid = errorCount === 0;

        return {
            valid,
            issues,
            warningCount,
            errorCount
        };
    }

    private mapSeverity(level: string): 'critical' | 'major' | 'minor' {
        switch (level.toUpperCase()) {
            case 'ERROR':
            case 'FATAL':
                return 'critical';
            case 'WARNING':
                return 'major';
            case 'INFO':
            case 'SUGGESTION':
                return 'minor';
            default:
                return 'minor';
        }
    }

    private isFixable(code: string): boolean {
        // Define which validation issues can be automatically fixed
        const fixableCodes = [
            // Real EpubCheck codes that can be fixed
            'RSC-005', // Missing language in metadata
            'RSC-006', // Remote resource reference
            'RSC-007', // Resource not found
            'RSC-017', // Missing title element in head
            'OPF-003', // Missing metadata
            'OPF-004', // Invalid metadata
            'OPF-025', // Missing language
            'OPF-026', // Invalid language
            'OPF-096', // Non-linear content reachability
            'HTM-009', // Missing title
            'HTM-011', // Missing lang attribute
            'HTM-014', // Invalid heading structure
            'CSS-001', // Invalid CSS
            'CSS-003', // Unused CSS
            'NCX-001', // Missing NCX
            'NCX-002', // Invalid NCX
            'PKG-001', // Missing files in manifest
            'PKG-003', // Unreferenced files
            'PKG-009', // Missing file in package
            'MED-001', // Invalid media type
            'ACC-001', // Missing accessibility metadata
            'ACC-002', // Missing alt text
            'ACC-003', // Poor heading structure
            'ACC-004', // Missing table headers
            'ACC-005'  // Missing landmarks
        ];

        const isFixable = fixableCodes.includes(code);
        this.logger.info(`EpubCheck code ${code} is fixable: ${isFixable}`);
        return isFixable;
    }

    async addValidationToContext(context: ProcessingContext): Promise<void> {
        try {
            if (!this.epubCheckPath) {
                this.logger.warn('EpubCheck not available - skipping EPUB validation');
                return;
            }

            this.logger.info('Starting addValidationToContext');
            const keepOutput = context.options?.keepOutput || false;
            const result = await this.validateEpub(context.epubPath, keepOutput);
            this.logger.info(`EpubCheck found ${result.issues.length} issues`);
            result.issues.forEach((issue, index) => {
                this.logger.info(`EpubCheck issue ${index + 1}: code="${issue.code}", message="${issue.message}", fixable=${issue.fixable}`);
            });
            context.issues.push(...result.issues);
            this.logger.info(`Added ${result.issues.length} validation issues to context. Total context issues: ${context.issues.length}`);
        } catch (error) {
            this.logger.error(`Failed to add validation to context: ${error}`);
            // Don't throw - continue processing even if validation fails
        }
    }
}
