import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs-extra';
import { AccessibilityIssue, ProcessingContext } from '../types';
import { Logger } from '../utils/common';
import { ToolInfo } from '../core/tool-installer';

const execAsync = promisify(exec);

export interface AccessibilityResult {
    score?: number;
    issues: AccessibilityIssue[];
    summary: {
        violationsCount: number;
        warningsCount: number;
        passesCount: number;
    };
    outputFile?: string;
}

export class AccessibilityAnalyzer {
    private logger: Logger;
    private acePath?: string;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    setAcePath(toolInfo: ToolInfo): void {
        if (toolInfo.installed && toolInfo.path) {
            this.acePath = toolInfo.path;
        } else {
            throw new Error('DAISY ACE is not installed or path is not available');
        }
    }

    async analyzeAccessibility(epubPath: string, keepOutput: boolean = false): Promise<AccessibilityResult> {
        if (!this.acePath) {
            throw new Error('DAISY ACE path not set. Call setAcePath first.');
        }

        this.logger.info(`Running accessibility analysis on ${epubPath}`);

        try {
            // Create temporary output directory
            const timestamp = Date.now();
            const inputBasename = path.basename(epubPath, '.epub');
            const inputDir = path.dirname(epubPath);

            const outputDir = keepOutput
                ? path.join(inputDir, `${inputBasename}_ace_report_${timestamp}`)
                : path.join(path.dirname(epubPath), `ace-report-${timestamp}`);

            await fs.ensureDir(outputDir);

            // Run DAISY ACE
            const command = `"${this.acePath}" "${epubPath}" --outdir "${outputDir}" --format json`;

            let stdout = '';
            let stderr = '';

            try {
                const result = await execAsync(command, {
                    maxBuffer: 1024 * 1024 * 10, // 10MB buffer
                    timeout: 600000 // 10 minute timeout for accessibility analysis
                });
                stdout = result.stdout;
                stderr = result.stderr;
            } catch (error: any) {
                // DAISY ACE might return non-zero exit code for EPUBs with accessibility issues
                stdout = error.stdout || '';
                stderr = error.stderr || '';
                this.logger.info('DAISY ACE completed with warnings (this is normal for EPUBs with accessibility issues)');
            }

            // Parse the results
            const reportPath = path.join(outputDir, 'report.json');
            let result: AccessibilityResult = {
                issues: [],
                summary: {
                    violationsCount: 0,
                    warningsCount: 0,
                    passesCount: 0
                }
            };

            if (await fs.pathExists(reportPath)) {
                try {
                    const reportData = await fs.readJson(reportPath);
                    this.logger.info(`DAISY ACE report found with data structure: ${Object.keys(reportData).join(', ')}`);
                    if (reportData.assertions) {
                        this.logger.info(`Found ${reportData.assertions.length} assertion groups`);
                    }
                    result = this.parseAccessibilityReport(reportData);
                    result.outputFile = keepOutput ? outputDir : undefined;
                    this.logger.info(`Parsed ${result.issues.length} issues from DAISY ACE report`);
                } catch (parseError) {
                    this.logger.warn(`Failed to parse DAISY ACE JSON report: ${parseError}`);
                    // Try to extract basic info from stdout/stderr
                    result = this.parseAccessibilityText(stdout + stderr);
                }
            } else {
                this.logger.warn(`DAISY ACE report not found at: ${reportPath}`);
                // No JSON report generated, parse text output
                result = this.parseAccessibilityText(stdout + stderr);
            }

            // Clean up temporary directory only if not keeping output
            try {
                if (!keepOutput) {
                    await fs.remove(outputDir);
                } else {
                    this.logger.info(`DAISY ACE report saved: ${outputDir}`);
                }
            } catch (cleanupError) {
                this.logger.warn(`Failed to cleanup temporary directory: ${cleanupError}`);
            }

            this.logger.info(`Accessibility analysis complete: ${result.issues.length} issues found`);
            return result;

        } catch (error) {
            this.logger.error(`Accessibility analysis failed: ${error}`);
            throw error;
        }
    }

    private parseAccessibilityReport(reportData: any): AccessibilityResult {
        const issues: AccessibilityIssue[] = [];
        let violationsCount = 0;
        let warningsCount = 0;
        let passesCount = 0;

        this.logger.info(`Parsing DAISY ACE report structure...`);

        // Debug: Log the report structure
        if (reportData.assertions) {
            this.logger.info(`Report has ${reportData.assertions.length} assertion groups`);

            for (let i = 0; i < Math.min(reportData.assertions.length, 3); i++) {
                const assertion = reportData.assertions[i];
                this.logger.info(`Assertion ${i}: url=${assertion.url}, assertions=${assertion.assertions?.length || 0}`);
            }
        } else {
            this.logger.warn('No assertions array found in DAISY ACE report');
            this.logger.info(`Available keys: ${Object.keys(reportData).join(', ')}`);
        }

        // Parse DAISY ACE report structure
        if (reportData.assertions) {
            for (const assertion of reportData.assertions) {
                const fileUrl = assertion['earl:testSubject']?.url || '';

                if (assertion.assertions) {
                    for (const subAssertion of assertion.assertions) {
                        const outcome = subAssertion['earl:result']?.['earl:outcome'];
                        const ruleTitle = subAssertion['earl:test']?.['dct:title'] || subAssertion['earl:test']?.title;

                        this.logger.info(`Processing assertion: outcome=${outcome}, rule=${ruleTitle}, file=${fileUrl}`);

                        if (outcome === 'fail') {
                            const issue: AccessibilityIssue = {
                                code: ruleTitle || 'accessibility-issue',
                                message: subAssertion['earl:result']?.['dct:description'] || subAssertion['dct:description'] || 'Accessibility issue detected',
                                severity: this.mapSeverity(subAssertion['earl:test']?.['earl:impact']),
                                impact: subAssertion['earl:test']?.['earl:impact'] || 'moderate',
                                type: 'error',
                                category: 'accessibility',
                                wcagLevel: 'AA',
                                wcagCriteria: [],
                                fixable: this.isAccessibilityFixable(subAssertion),
                                location: {
                                    file: fileUrl,
                                    line: 0,
                                    column: 0
                                },
                                element: this.extractElementInfo(subAssertion)
                            };
                            issues.push(issue);
                            violationsCount++;
                            this.logger.info(`Added issue: ${issue.code} - ${issue.message}`);
                        } else if (outcome === 'pass') {
                            passesCount++;
                        }
                    }
                }
            }
        }

        this.logger.info(`Parsed ${issues.length} accessibility issues`);

        return {
            issues,
            summary: {
                violationsCount,
                warningsCount,
                passesCount
            },
            score: this.calculateScore(issues)
        };
    }

    private parseAccessibilityText(text: string): AccessibilityResult {
        const issues: AccessibilityIssue[] = [];

        // Basic text parsing for fallback
        const lines = text.split('\n');
        let violationsCount = 0;

        for (const line of lines) {
            if (line.includes('violation') || line.includes('error') || line.includes('fail')) {
                const issue: AccessibilityIssue = {
                    code: 'accessibility-issue',
                    message: line.trim(),
                    severity: 'major',
                    impact: 'serious',
                    type: 'error',
                    category: 'accessibility',
                    wcagLevel: 'AA',
                    wcagCriteria: [],
                    fixable: false,
                    location: { file: '', line: 0, column: 0 },
                    element: ''
                };
                issues.push(issue);
                violationsCount++;
            }
        }

        return {
            issues,
            summary: {
                violationsCount,
                warningsCount: 0,
                passesCount: 0
            },
            score: this.calculateScore(issues)
        };
    }

    private extractElementInfo(assertion: any): string {
        // Extract element information from various possible locations
        if (assertion['earl:result']?.html) {
            const htmlMatch = assertion['earl:result'].html.match(/<(\w+)/);
            return htmlMatch ? htmlMatch[1] : '';
        }

        if (assertion['earl:result']?.['earl:pointer']?.css) {
            const cssSelectors = assertion['earl:result']['earl:pointer'].css;
            if (Array.isArray(cssSelectors) && cssSelectors.length > 0) {
                const selector = cssSelectors[0];
                const elementMatch = selector.match(/^(\w+)/);
                return elementMatch ? elementMatch[1] : '';
            }
        }

        return '';
    }

    private extractRuleId(assertion: any): string {
        // Updated to work with new DAISY ACE structure
        if (assertion['earl:test']?.['dct:title']) {
            return assertion['earl:test']['dct:title'];
        }
        if (assertion['earl:test']?.title) {
            return assertion['earl:test'].title;
        }
        return assertion.rule || assertion.id || 'accessibility-issue';
    }

    private mapSeverity(impact: string): 'critical' | 'major' | 'minor' {
        switch (impact) {
            case 'critical':
                return 'critical';
            case 'serious':
                return 'major';
            case 'moderate':
                return 'major';
            case 'minor':
                return 'minor';
            default:
                return 'major';
        }
    }

    private calculateScore(issues: AccessibilityIssue[]): number {
        if (issues.length === 0) return 100;

        let score = 100;
        for (const issue of issues) {
            switch (issue.impact) {
                case 'critical':
                    score -= 20;
                    break;
                case 'serious':
                    score -= 10;
                    break;
                case 'moderate':
                    score -= 5;
                    break;
                case 'minor':
                    score -= 2;
                    break;
            }
        }

        return Math.max(0, score);
    }

    private isAccessibilityFixable(assertion: any): boolean {
        // Check if this type of accessibility issue can be automatically fixed
        const fixableRules = [
            'image-alt',                    // Missing alt text
            'html-has-lang',               // Missing language attribute
            'document-title',              // Missing document title
            'heading-order',               // Heading structure issues
            'color-contrast',              // Color contrast (partially fixable)
            'link-name',                   // Links without discernible text
            'button-name',                 // Buttons without accessible names
            'label',                       // Form labels
            'aria-label',                  // ARIA labels
            'aria-labelledby',             // ARIA labelledby references
            'epub-lang',                   // EPUB language attribute
            'metadata-accessmode',         // Accessibility metadata
            'metadata-accessmodesufficient', // Accessibility metadata
            'link-in-text-block',          // Link color contrast
            'epub-type-has-matching-role', // EPUB type to ARIA role mapping
            'non-linear-content',          // Non-linear content reachability
            'landmark-unique',             // Landmark must have unique accessible name
            'OPF-096'                      // Non-linear content reachability (EPUB validation code)
        ];

        const ruleId = assertion['earl:test']?.['dct:title'] || assertion['earl:test']?.title || '';
        const isFixableByCode = fixableRules.some(rule => ruleId.includes(rule));

        // Also check message content for specific patterns
        const message = assertion['earl:result']?.['dct:description'] || assertion.description || assertion.message || '';
        const isFixableByMessage = this.isAccessibilityFixableByMessage(message);
        
        const isFixable = isFixableByCode || isFixableByMessage;
        this.logger.info(`Accessibility assertion with ruleId="${ruleId}" and message="${message}" is fixable: ${isFixable} (byCode: ${isFixableByCode}, byMessage: ${isFixableByMessage})`);
        return isFixable;
    }

    // Check if an issue is fixable based on its message content (for cases where DAISY ACE provides detailed messages)
    private isAccessibilityFixableByMessage(message: string): boolean {
        const fixableMessagePatterns = [
            'Element does not have text that is visible to screen readers',
            'aria-label attribute does not exist or is empty',
            'aria-labelledby attribute does not exist',
            'Element has no title attribute',
            'The element does not have a lang attribute',
            'does not have a lang attribute',
            'missing lang attribute',
            'html element missing language attribute',
            'html> element must have a lang attribute',  // DAISY ACE specific message
            'Element has no ARIA role matching its epub:type',
            'Non-linear content must be reachable',
            'Landmarks should have a unique role or role/label/title',  // landmark-unique message
            'The landmark must have a unique aria-label, aria-labelledby, or title'  // landmark-unique message
        ];

        const isFixable = fixableMessagePatterns.some(pattern =>
            message.toLowerCase().includes(pattern.toLowerCase())
        );
        
        this.logger.info(`Accessibility message "${message}" is fixable: ${isFixable}`);
        return isFixable;
    }

    async addAccessibilityToContext(context: ProcessingContext): Promise<void> {
        try {
            this.logger.info('Starting addAccessibilityToContext');
            const keepOutput = context.options?.keepOutput || false;
            const result = await this.analyzeAccessibility(context.epubPath, keepOutput);
            this.logger.info(`DAISY ACE found ${result.issues.length} issues`);
            result.issues.forEach((issue, index) => {
                this.logger.info(`DAISY ACE issue ${index + 1}: code="${issue.code}", message="${issue.message}", fixable=${issue.fixable}`);
            });
            context.issues.push(...result.issues);
            this.logger.info(`Added ${result.issues.length} accessibility issues to context. Total context issues: ${context.issues.length}`);
        } catch (error) {
            this.logger.error(`Failed to add accessibility analysis to context: ${error}`);
            // Don't throw - continue processing even if accessibility analysis fails
        }
    }

    async performQuickAccessibilityCheck(context: ProcessingContext): Promise<AccessibilityIssue[]> {
        // Fallback accessibility check when DAISY ACE is not available
        this.logger.info('Performing quick accessibility check...');

        const issues: AccessibilityIssue[] = [];

        // Check for basic accessibility issues in content files
        for (const [path, content] of context.contents) {
            if (content.mediaType === 'application/xhtml+xml' || content.mediaType === 'text/html') {
                const cheerio = require('cheerio');
                const $ = cheerio.load(content.content);

                // Check for images without alt text
                $('img').each((_, img) => {
                    const $img = $(img);
                    const alt = $img.attr('alt');
                    if (!alt && alt !== '') { // Allow empty alt for decorative images
                        issues.push({
                            code: 'image-alt',
                            message: `Image missing alt attribute`,
                            severity: 'major',
                            impact: 'serious',
                            type: 'error',
                            category: 'accessibility',
                            wcagLevel: 'A',
                            wcagCriteria: ['1.1.1'],
                            fixable: true,
                            location: { file: path, line: 0, column: 0 },
                            element: 'img'
                        });
                    }
                });

                // Check for missing language attribute
                const $html = $('html');
                if ($html.length > 0 && !$html.attr('lang') && !$html.attr('xml:lang')) {
                    issues.push({
                        code: 'html-has-lang',
                        message: 'Document missing language attribute',
                        severity: 'major',
                        impact: 'serious',
                        type: 'error',
                        category: 'accessibility',
                        wcagLevel: 'A',
                        wcagCriteria: ['3.1.1'],
                        fixable: true,
                        location: { file: path, line: 0, column: 0 },
                        element: 'html'
                    });
                }

                // Check for missing document title
                const $title = $('title');
                if ($title.length === 0 || !$title.text().trim()) {
                    issues.push({
                        code: 'document-title',
                        message: 'Document missing title',
                        severity: 'major',
                        impact: 'serious',
                        type: 'error',
                        category: 'accessibility',
                        wcagLevel: 'A',
                        wcagCriteria: ['2.4.2'],
                        fixable: true,
                        location: { file: path, line: 0, column: 0 },
                        element: 'head'
                    });
                }
            }
        }

        this.logger.info(`Quick accessibility check found ${issues.length} issues`);
        return issues;
    }
}