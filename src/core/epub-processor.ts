import * as path from 'path';
import * as fs from 'fs-extra';

import { AnalysisResult, ProcessingContext, FixerConfig, CliOptions, AccessibilityIssue } from '../types';
import { Logger, cleanupTemp } from '../utils/common';
import { EpubParser } from './epub-parser';
import { ExternalToolInstaller, ToolInfo } from './tool-installer';
import { ValidationRunner } from '../validators/epub-validator';
import { AccessibilityAnalyzer } from '../validators/accessibility-analyzer';
import { IssueCategorizer } from './issue-categorizer';
import { FixerOrchestrator } from './fixer-orchestrator';
import { HtmlReportGenerator } from '../reporters/html-reporter';
import { EpubVersionDetector } from '../utils/epub-version-detector';

export class EpubAccessibilityProcessor {
    private logger: Logger;
    private toolInstaller: ExternalToolInstaller;
    private epubParser: EpubParser;
    private validationRunner: ValidationRunner;
    private accessibilityAnalyzer: AccessibilityAnalyzer;
    private issueCategorizer: IssueCategorizer;
    private fixerOrchestrator: FixerOrchestrator;
    private reportGenerator: HtmlReportGenerator;
    private versionDetector: EpubVersionDetector;

    private toolsInitialized = false;
    private epubCheckTool?: ToolInfo;
    private daisyAceTool?: ToolInfo;

    constructor(logger: Logger) {
        this.logger = logger;
        this.toolInstaller = new ExternalToolInstaller(logger);
        this.epubParser = new EpubParser(logger);
        this.validationRunner = new ValidationRunner(logger);
        this.accessibilityAnalyzer = new AccessibilityAnalyzer(logger);
        this.issueCategorizer = new IssueCategorizer(logger);
        this.fixerOrchestrator = new FixerOrchestrator(logger);
        this.reportGenerator = new HtmlReportGenerator(logger);
        this.versionDetector = new EpubVersionDetector(logger);
    }

    async initializeTools(): Promise<void> {
        if (this.toolsInitialized) {
            return;
        }

        this.logger.info('Initializing external tools...');

        // Check system requirements
        const systemOk = await this.toolInstaller.verifySystemRequirements();
        if (!systemOk) {
            throw new Error('System requirements not met. Please install Java and Node.js');
        }

        // Install tools
        const tools = await this.toolInstaller.installAllTools();
        this.epubCheckTool = tools.epubcheck;
        this.daisyAceTool = tools.daisyAce;

        if (!this.epubCheckTool.installed) {
            this.logger.warn('EpubCheck not available - EPUB validation will be skipped');
            this.logger.warn('To enable full validation, please ensure Java 8+ is installed');
        }

        if (!this.daisyAceTool.installed) {
            this.logger.warn('DAISY ACE not available - accessibility analysis will be limited');
        }

        // Configure validators only if tools are available
        if (this.epubCheckTool.installed) {
            this.validationRunner.setEpubCheckPath(this.epubCheckTool);
        }

        if (this.daisyAceTool.installed) {
            this.accessibilityAnalyzer.setAcePath(this.daisyAceTool);
        }

        this.toolsInitialized = true;
        this.logger.success('External tools initialized successfully');
    }

    async processEpub(options: CliOptions, config: FixerConfig): Promise<AnalysisResult> {
        const startTime = new Date();
        this.logger.info(`Processing EPUB: ${options.input}`);

        // Check EPUB version first - reject EPUB 2.0
        const versionInfo = await this.versionDetector.detectVersion(options.input);
        if (versionInfo.isEpub2) {
            throw new Error(
                `EPUB 2.0 detected. This tool only supports EPUB 3.0+ validation and fixing. ` +
                `Please use the 'convert' command to upgrade to EPUB 3.0 first: epub-fix convert "${options.input}"`
            );
        }

        this.logger.info(`EPUB version ${versionInfo.version} confirmed - proceeding with processing`);

        let context: ProcessingContext | null = null;

        try {
            // Ensure tools are initialized
            await this.initializeTools();

            // Extract and parse EPUB
            this.logger.info('Extracting EPUB...');
            context = await this.epubParser.extractEpub(options.input);
            context.config = config;
            context.options = options;

            // Run validation if not skipped
            let validationResult: any = null;
            if (!options.skipValidation) {
                this.logger.info('Running EPUB validation...');
                validationResult = await this.validationRunner.validateEpub(context.epubPath, options.keepOutput || false);
                context.issues.push(...validationResult.issues);
            }

            // Run accessibility analysis if not skipped
            let accessibilityResult: any = null;
            if (!options.skipAccessibility) {
                if (this.daisyAceTool?.installed) {
                    this.logger.info('Running accessibility analysis with DAISY ACE...');
                    accessibilityResult = await this.accessibilityAnalyzer.analyzeAccessibility(context.epubPath, options.keepOutput || false);
                    this.logger.info(`DAISY ACE returned ${accessibilityResult.issues.length} issues`);
                    context.issues.push(...accessibilityResult.issues);
                    this.logger.info(`Total issues in context after adding accessibility: ${context.issues.length}`);
                } else {
                    this.logger.info('Running quick accessibility check...');
                    const quickIssues = await this.accessibilityAnalyzer.performQuickAccessibilityCheck(context);
                    context.issues.push(...quickIssues);
                }
            }

            // Categorize issues
            this.logger.info('Categorizing issues...');
            this.logger.info(`Issues before categorization: ${context.issues.length}`);
            this.logger.info(`  - Accessibility: ${context.issues.filter(i => i.category === 'accessibility').length}`);
            this.logger.info(`  - Validation: ${context.issues.filter(i => i.category === 'validation').length}`);
            const categorizedIssues = this.issueCategorizer.categorizeIssues(context.issues);

            // Apply fixes if not in analyze-only mode
            if (!options.analyze && !options.dryRun) {
                this.logger.info('Applying fixes...');
                const fixResults = await this.fixerOrchestrator.fixAllIssues(context);

                // Validate fixes
                const validation = await this.fixerOrchestrator.validateFixes(context);
                if (validation.errors.length > 0) {
                    this.logger.error(`Fix validation errors: ${validation.errors.join(', ')}`);
                }

                // Create output EPUB
                if (options.output) {
                    this.logger.info('Creating fixed EPUB...');
                    await this.epubParser.repackageEpub(context, options.output);
                }
            } else if (options.dryRun) {
                this.logger.info('Performing dry run...');
                const dryRunResult = await this.fixerOrchestrator.performDryRun(context);
                this.logger.info(`Dry run complete: ${dryRunResult.fixableIssues.length} issues could be fixed`);
            }

            // Generate report
            if (options.reportPath) {
                this.logger.info('Generating HTML report...');
                await this.reportGenerator.generateReport(
                    context,
                    categorizedIssues,
                    context.fixes,
                    options.reportPath,
                    startTime
                );
            }

            // Create analysis result
            const result: AnalysisResult = {
                epub: {
                    path: options.input,
                    title: context.metadata.title,
                    metadata: context.metadata,
                    structure: context.manifest
                },
                validation: {
                    valid: !context.issues.some(i => i.category === 'validation' && i.type === 'error'),
                    issues: context.issues.filter(i => i.category === 'validation')
                },
                accessibility: {
                    issues: context.issues.filter(i => i.category === 'accessibility') as AccessibilityIssue[],
                    score: this.calculateAccessibilityScore(context.issues.filter(i => i.category === 'accessibility'))
                },
                summary: {
                    totalIssues: context.issues.length,
                    criticalIssues: context.issues.filter(i => i.severity === 'critical').length,
                    // Calculate fixable issues as the maximum of initially fixable or actually fixed
                    // This accounts for fixes that resolve issues not initially marked as fixable
                    fixableIssues: Math.max(
                        context.issues.filter(i => i.fixable).length,
                        context.issues.filter(i => i.fixed === true).length
                    ),
                    fixedIssues: context.issues.filter(i => i.fixed === true).length
                },
                outputFiles: options.keepOutput ? {
                    epubCheck: validationResult?.outputFile,
                    epubCheckText: validationResult?.outputTextFile, // Add text file output
                    daisyAce: accessibilityResult?.outputFile
                } : undefined
            };

            const duration = Date.now() - startTime.getTime();
            this.logger.success(`Processing completed in ${Math.round(duration / 1000)}s`);

            return result;

        } catch (error) {
            this.logger.error(`Processing failed: ${error}`);
            throw error;
        } finally {
            // Cleanup temporary files
            if (context) {
                await cleanupTemp(context.tempDir);
            }
        }
    }

    private calculateAccessibilityScore(accessibilityIssues: any[]): number | undefined {
        // Filter out fixed issues
        const unfixedIssues = accessibilityIssues.filter(issue => !issue.fixed);

        if (unfixedIssues.length === 0) {
            // If there are no unfixed issues, return 100 (or undefined if no accessibility issues at all)
            return accessibilityIssues.length > 0 ? 100 : undefined;
        }

        let score = 100;
        for (const issue of unfixedIssues) {
            switch (issue.severity) {
                case 'critical':
                    score -= 20;
                    break;
                case 'major':
                    score -= 10;
                    break;
                case 'minor':
                    score -= 2;
                    break;
            }
        }

        return Math.max(0, score);
    }

    async analyzeOnly(epubPath: string, config: FixerConfig): Promise<AnalysisResult> {
        const options: CliOptions = {
            input: epubPath,
            analyze: true,
            verbose: false
        };

        return this.processEpub(options, config);
    }

    async fixEpub(
        inputPath: string,
        outputPath: string,
        config: FixerConfig,
        reportPath?: string
    ): Promise<AnalysisResult> {
        const options: CliOptions = {
            input: inputPath,
            output: outputPath,
            reportPath,
            analyze: false,
            verbose: false
        };

        return this.processEpub(options, config);
    }

    async validateEpubOnly(epubPath: string): Promise<{ valid: boolean; issues: any[] }> {
        await this.initializeTools();

        const result = await this.validationRunner.validateEpub(epubPath);

        return {
            valid: result.valid,
            issues: result.issues
        };
    }

    getToolStatus(): { epubcheck: boolean; daisyAce: boolean } {
        return {
            epubcheck: this.epubCheckTool?.installed || false,
            daisyAce: this.daisyAceTool?.installed || false
        };
    }

    getAvailableFixers(): string[] {
        return this.fixerOrchestrator.getAvailableFixers();
    }

    getSupportedIssueCodes(): string[] {
        return this.fixerOrchestrator.getHandledCodes();
    }
}