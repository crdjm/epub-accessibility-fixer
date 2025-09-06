#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import * as dotenv from 'dotenv';

import { EpubAccessibilityProcessor } from './core/epub-processor';
import { Logger, isValidEpubPath, formatFileSize } from './utils/common';
import { loadConfig } from './core/config';
import { CliOptions } from './types';
import { EpubVersionDetector } from './utils/epub-version-detector';
import { Epub2To3Converter } from './core/epub2-to-3-converter';

// Load environment variables from .env file
dotenv.config();

const program = new Command();

/**
 * Run verification by re-running validation tools on the fixed EPUB
 */
async function runVerification(
    fixedEpubPath: string, 
    processor: EpubAccessibilityProcessor, 
    logger: Logger, 
    inputBasename: string, 
    inputDir: string
): Promise<void> {
    const spinner = ora();
    
    try {
        console.log(`\n${chalk.blue('🔍 Verification Phase:')}`);
        console.log(`Re-running validation tools on the fixed EPUB to verify fixes...`);
        
        // Create timestamped directory for verification output
        const timestamp = Date.now();
        const verifyDir = path.join(inputDir, `${inputBasename}_verification_${timestamp}`);
        await fs.ensureDir(verifyDir);
        
        // Create verification options that force keeping output files
        const verifyOptions: CliOptions = {
            input: fixedEpubPath,
            analyze: true, // Analysis only for verification
            verbose: logger.isVerbose(),
            keepOutput: true // Always keep verification output
        };
        
        spinner.start('Running verification analysis...');
        
        // Process the fixed EPUB with analysis only
        const verifyResult = await processor.processEpub(verifyOptions, loadConfig());
        
        spinner.succeed('Verification complete');
        
        // Move output files to verification directory if they exist
        if (verifyResult.outputFiles) {
            if (verifyResult.outputFiles.epubCheck) {
                const verifyEpubCheckPath = path.join(verifyDir, 'epubcheck_verification.json');
                await fs.move(verifyResult.outputFiles.epubCheck, verifyEpubCheckPath);
                verifyResult.outputFiles.epubCheck = verifyEpubCheckPath;
            }
            
            if (verifyResult.outputFiles.epubCheckText) {
                const verifyEpubCheckTextPath = path.join(verifyDir, 'epubcheck.txt');
                await fs.move(verifyResult.outputFiles.epubCheckText, verifyEpubCheckTextPath);
                verifyResult.outputFiles.epubCheckText = verifyEpubCheckTextPath;
            }
            
            if (verifyResult.outputFiles.daisyAce) {
                const verifyDaisyPath = path.join(verifyDir, 'daisy_ace_verification');
                await fs.move(verifyResult.outputFiles.daisyAce, verifyDaisyPath);
                verifyResult.outputFiles.daisyAce = verifyDaisyPath;
            }
        }
        
        // Display verification results
        console.log(`\n${chalk.bold('Verification Results:')}`);
        
        const verifyValidationErrors = verifyResult.validation.issues.filter(i => i.type === 'error').length;
        const verifyValidationWarnings = verifyResult.validation.issues.filter(i => i.type === 'warning').length;
        const verifyAccessibilityIssues = verifyResult.accessibility.issues.length;
        
        // Validation results
        if (verifyValidationErrors === 0) {
            console.log(`${chalk.green('✓ Validation:')} No errors found`);
        } else {
            console.log(`${chalk.red('✗ Validation:')} ${verifyValidationErrors} errors remaining`);
        }
        
        if (verifyValidationWarnings > 0) {
            console.log(`${chalk.yellow('⚠️  Validation warnings:')} ${verifyValidationWarnings}`);
        }
        
        // Accessibility results
        if (verifyAccessibilityIssues === 0) {
            console.log(`${chalk.green('✓ Accessibility:')} No issues found`);
        } else {
            console.log(`${chalk.red('✗ Accessibility:')} ${verifyAccessibilityIssues} issues remaining`);
        }
        
        // Overall score
        if (verifyResult.accessibility.score !== undefined) {
            const scoreColor = verifyResult.accessibility.score >= 90 ? chalk.green : 
                              verifyResult.accessibility.score >= 70 ? chalk.yellow : chalk.red;
            console.log(`${chalk.cyan('Accessibility Score:')} ${scoreColor(`${verifyResult.accessibility.score}/100`)}`);
        }
        
        console.log(`\n${chalk.blue('Verification Files Saved:')}`);
        console.log(`${chalk.gray('Directory:')} ${verifyDir}`);
        if (verifyResult.outputFiles?.epubCheck) {
            console.log(`${chalk.gray('EpubCheck JSON:')} ${path.basename(verifyResult.outputFiles.epubCheck)}`);
        }
        if (verifyResult.outputFiles?.epubCheckText) {
            console.log(`${chalk.gray('EpubCheck Text:')} ${path.basename(verifyResult.outputFiles.epubCheckText)}`);
        }
        if (verifyResult.outputFiles?.daisyAce) {
            console.log(`${chalk.gray('DAISY ACE:')} ${path.basename(verifyResult.outputFiles.daisyAce)}`);
        }
        
        // Summary message
        if (verifyValidationErrors === 0 && verifyAccessibilityIssues === 0) {
            console.log(`\n${chalk.green('🎉 Success!')} All fixes verified successfully - no issues remaining.`);
        } else if (verifyValidationErrors === 0) {
            console.log(`\n${chalk.yellow('📝 Note:')} Validation issues resolved, but ${verifyAccessibilityIssues} accessibility issues remain.`);
        } else {
            console.log(`\n${chalk.red('⚠️  Warning:')} Some issues remain after fixing. Manual intervention may be required.`);
        }
        
    } catch (error: any) {
        spinner.fail('Verification failed');
        console.error(chalk.red(`\nVerification error: ${error.message}`));
        if (logger.isVerbose()) {
            console.error(chalk.gray('Stack trace:'));
            console.error(chalk.gray(error.stack));
        }
    }
}

program
    .name('epub-fix')
    .description('CLI tool for analyzing and fixing EPUB accessibility issues')
    .version('1.0.0');

program
    .argument('<input>', 'Path to the EPUB file to analyze/fix')
    .option('-o, --output <path>', 'Output path for the fixed EPUB (defaults to input_fixed.epub)')
    .option('-r, --report <path>', 'Path for the HTML report (defaults to input_report.html)')
    .option('-a, --analyze-only', 'Only analyze, do not fix issues')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--skip-validation', 'Skip EPUB validation checks')
    .option('--skip-accessibility', 'Skip accessibility analysis')
    .option('--dry-run', 'Show what would be fixed without making changes')
    .option('--keep-output', 'Keep DAISY ACE and EpubCheck output files for manual review')
    .option('--verify', 'Re-run validation tools on the fixed EPUB to verify fixes were successful')
    .option('--use-gemini', 'Use Gemini AI models for alt text generation instead of Ollama')
    .option('-v, --verbose', 'Verbose output')
    .action(async (input: string, options: any) => {
        const spinner = ora();

        try {
            // Validate input file
            if (!isValidEpubPath(input)) {
                console.error(chalk.red(`Error: Invalid EPUB file: ${input}`));
                process.exit(1);
            }

            const inputPath = path.resolve(input);
            const inputBasename = path.basename(inputPath, '.epub');
            const inputDir = path.dirname(inputPath);

            // Initialize logger early for version detection
            const versionLogger = new Logger(options.verbose || false);

            // Check EPUB version first
            spinner.start('Detecting EPUB version...');
            const versionDetector = new EpubVersionDetector(versionLogger);
            const versionInfo = await versionDetector.detectVersion(inputPath);
            spinner.succeed(`EPUB version detected: ${versionInfo.version}`);

            // Handle EPUB 2.0 files
            if (versionInfo.isEpub2) {
                console.log(chalk.yellow('\n⚠️  EPUB 2.0 detected!'));
                console.log(chalk.yellow('This tool only supports validation and fixing of EPUB 3.0+ files.'));
                console.log(chalk.blue('\n💡 Would you like to convert this EPUB 2.0 to EPUB 3.0 format?'));
                console.log(chalk.gray('After conversion, you can re-run this tool for validation and accessibility fixing.'));

                // For now, automatically convert. In a real implementation, you might want to prompt the user
                const convertedPath = options.output ?
                    path.resolve(options.output) :
                    path.join(inputDir, `${inputBasename}_epub3.epub`);

                spinner.start('Converting EPUB 2.0 to EPUB 3.0...');
                const converter = new Epub2To3Converter(versionLogger);
                const conversionResult = await converter.convertEpub2To3(inputPath, convertedPath);

                if (conversionResult.success) {
                    spinner.succeed('EPUB 2.0 to 3.0 conversion completed!');

                    console.log(`\n${chalk.green('✓ Conversion successful!')}`);
                    console.log(`${chalk.blue('Converted EPUB:')} ${convertedPath}`);

                    if (conversionResult.changes.length > 0) {
                        console.log(`\n${chalk.cyan('Changes made:')}`);
                        conversionResult.changes.forEach(change => {
                            console.log(`  • ${change}`);
                        });
                    }

                    if (conversionResult.warnings.length > 0) {
                        console.log(`\n${chalk.yellow('Warnings:')}`);
                        conversionResult.warnings.forEach(warning => {
                            console.log(`  ⚠️  ${warning}`);
                        });
                    }

                    console.log(`\n${chalk.blue('Next steps:')}`);
                    console.log(`1. Review the converted EPUB: ${convertedPath}`);
                    console.log(`2. Run this tool again on the converted file for validation and accessibility fixing:`);
                    console.log(`   ${chalk.gray(`epub-fix "${convertedPath}"`)}`);;

                    process.exit(0);
                } else {
                    spinner.fail('EPUB 2.0 to 3.0 conversion failed');
                    console.error(chalk.red('\n❌ Conversion failed:'));
                    conversionResult.errors.forEach(error => {
                        console.error(`  • ${error}`);
                    });
                    process.exit(1);
                }
            }

            // Set up options
            const cliOptions: CliOptions = {
                input: inputPath,
                output: options.output ? path.resolve(options.output) : path.join(inputDir, `${inputBasename}_fixed.epub`),
                reportPath: options.report ? path.resolve(options.report) : path.join(inputDir, `${inputBasename}_report.html`),
                analyze: options.analyzeOnly || false,
                config: options.config,
                verbose: options.verbose || false,
                skipValidation: options.skipValidation || false,
                skipAccessibility: options.skipAccessibility || false,
                dryRun: options.dryRun || false,
                keepOutput: options.keepOutput || false,
                verify: options.verify || false,
                useGemini: options.useGemini || false
            };

            // Initialize logger
            const logger = new Logger(cliOptions.verbose);

            // Load configuration
            const config = loadConfig(cliOptions.config);

            logger.info('Starting EPUB accessibility analysis and fixing...');
            logger.info(`Input: ${cliOptions.input}`);

            if (!cliOptions.analyze) {
                logger.info(`Output: ${cliOptions.output}`);
            }

            logger.info(`Report: ${cliOptions.reportPath}`);

            // Initialize processor
            const processor = new EpubAccessibilityProcessor(logger);

            // Install tools if needed
            spinner.start('Installing required tools...');
            await processor.initializeTools();
            spinner.succeed('Tools ready');

            // Process EPUB
            spinner.start('Processing EPUB...');
            const result = await processor.processEpub(cliOptions, config);
            spinner.succeed('Processing complete');

            // Display results
            console.log('\n' + chalk.bold('Analysis Results:'));
            console.log(`Total issues found: ${chalk.yellow(result.summary.totalIssues)}`);
            console.log(`Critical issues: ${chalk.red(result.summary.criticalIssues)}`);
            console.log(`Fixable issues: ${chalk.blue(result.summary.fixableIssues)}`);

            if (!cliOptions.analyze) {
                console.log(`Fixed issues: ${chalk.green(result.summary.fixedIssues)}`);
            }

            // Display validation score
            const unfixedValidationErrors = result.validation.issues.filter(i => i.type === 'error' && !i.fixed).length;
            const validationScore = unfixedValidationErrors === 0 ? 100 :
                Math.max(0, 100 - unfixedValidationErrors * 10);
            console.log(`Validation score: ${chalk.cyan(`${validationScore}/100`)}`);

            if (result.accessibility.score !== undefined) {
                console.log(`Accessibility score: ${chalk.cyan(`${result.accessibility.score}/100`)}`);
            }

            // Show critical issues
            const criticalIssues = result.validation.issues.concat(result.accessibility.issues)
                .filter(issue => issue.severity === 'critical');

            if (criticalIssues.length > 0) {
                console.log('\n' + chalk.red.bold('Critical Issues:'));
                criticalIssues.slice(0, 5).forEach(issue => {
                    console.log(`  • ${issue.message} (${issue.code})`);
                });

                if (criticalIssues.length > 5) {
                    console.log(`  ... and ${criticalIssues.length - 5} more`);
                }
            }

            // Output file info
            if (!cliOptions.analyze && !cliOptions.dryRun) {
                if (await fs.pathExists(cliOptions.output!)) {
                    const stats = await fs.stat(cliOptions.output!);
                    console.log(`\n${chalk.green('Fixed EPUB saved:')} ${cliOptions.output}`);
                    console.log(`Size: ${formatFileSize(stats.size)}`);
                }
            }

            // Report info
            if (await fs.pathExists(cliOptions.reportPath!)) {
                console.log(`\n${chalk.blue('HTML Report:')} ${cliOptions.reportPath}`);
            }

            // Show preserved output files if option enabled
            if (cliOptions.keepOutput && result.outputFiles) {
                console.log(`\n${chalk.yellow('Preserved Output Files:')}`);
                if (result.outputFiles.daisyAce) {
                    console.log(`DAISY ACE Report: ${result.outputFiles.daisyAce}`);
                }
                if (result.outputFiles.epubCheck) {
                    console.log(`EpubCheck Output: ${result.outputFiles.epubCheck}`);
                }
            }

            // Run verification if requested and fixes were applied
            if (cliOptions.verify && !cliOptions.analyze && !cliOptions.dryRun && cliOptions.output) {
                if (await fs.pathExists(cliOptions.output)) {
                    await runVerification(cliOptions.output, processor, logger, inputBasename, inputDir);
                } else {
                    console.log(`\n${chalk.yellow('⚠️  Verification skipped: Fixed EPUB not found')}`);
                }
            }

            // Recommendations
            if (cliOptions.analyze && result.summary.fixableIssues > 0) {
                console.log('\n' + chalk.yellow('💡 Recommendation:'));
                console.log('Run without --analyze-only to automatically fix issues');
            } else if (!cliOptions.analyze && result.summary.fixableIssues > result.summary.fixedIssues) {
                const unfixedCount = result.summary.fixableIssues - result.summary.fixedIssues;
                console.log('\n' + chalk.yellow('💡 Note:'));
                console.log(`${unfixedCount} fixable issues remain. Some fixes may require manual intervention or additional fixers.`);
            }

            if (criticalIssues.length > 0) {
                console.log('\n' + chalk.red('⚠️  Warning:'));
                console.log('Critical issues detected. Please review the HTML report for details.');
            }

        } catch (error: any) {
            spinner.fail('Processing failed');
            console.error(chalk.red(`\nError: ${error.message}`));

            if (options.verbose) {
                console.error(chalk.gray('\nStack trace:'));
                console.error(chalk.gray(error.stack));
            }

            process.exit(1);
        }
    });

// Install tools command
program
    .command('install-tools')
    .description('Install or update required external tools')
    .option('-v, --verbose', 'Verbose output')
    .action(async (options) => {
        const logger = new Logger(options.verbose);
        const processor = new EpubAccessibilityProcessor(logger);

        try {
            console.log(chalk.blue('Installing required tools...'));
            await processor.initializeTools();
            console.log(chalk.green('✓ All tools installed successfully'));
        } catch (error: any) {
            console.error(chalk.red(`Installation failed: ${error.message}`));
            process.exit(1);
        }
    });

// Convert command for EPUB 2.0 to 3.0
program
    .command('convert <input>')
    .description('Convert EPUB 2.0 to EPUB 3.0 format')
    .option('-o, --output <path>', 'Output path for the converted EPUB (defaults to input_epub3.epub)')
    .option('-v, --verbose', 'Verbose output')
    .action(async (input: string, options) => {
        const spinner = ora();
        const logger = new Logger(options.verbose);

        try {
            if (!isValidEpubPath(input)) {
                console.error(chalk.red(`Error: Invalid EPUB file: ${input}`));
                process.exit(1);
            }

            const inputPath = path.resolve(input);
            const inputBasename = path.basename(inputPath, '.epub');
            const inputDir = path.dirname(inputPath);
            const outputPath = options.output ?
                path.resolve(options.output) :
                path.join(inputDir, `${inputBasename}_epub3.epub`);

            // Check EPUB version
            spinner.start('Detecting EPUB version...');
            const versionDetector = new EpubVersionDetector(logger);
            const versionInfo = await versionDetector.detectVersion(inputPath);
            spinner.succeed(`EPUB version detected: ${versionInfo.version}`);

            if (!versionInfo.isEpub2) {
                console.log(chalk.yellow(`⚠️  This EPUB is already version ${versionInfo.version}`));
                console.log(chalk.blue('No conversion needed. Use the main command for validation and fixing.'));
                process.exit(0);
            }

            // Convert EPUB 2.0 to 3.0
            spinner.start('Converting EPUB 2.0 to EPUB 3.0...');
            const converter = new Epub2To3Converter(logger);
            const conversionResult = await converter.convertEpub2To3(inputPath, outputPath);

            if (conversionResult.success) {
                spinner.succeed('EPUB 2.0 to 3.0 conversion completed!');

                console.log(`\n${chalk.green('✓ Conversion successful!')}`);
                console.log(`${chalk.blue('Input:')} ${inputPath}`);
                console.log(`${chalk.blue('Output:')} ${outputPath}`);

                if (conversionResult.changes.length > 0) {
                    console.log(`\n${chalk.cyan('Changes made:')}`);
                    conversionResult.changes.forEach(change => {
                        console.log(`  • ${change}`);
                    });
                }

                if (conversionResult.warnings.length > 0) {
                    console.log(`\n${chalk.yellow('Warnings:')}`);
                    conversionResult.warnings.forEach(warning => {
                        console.log(`  ⚠️  ${warning}`);
                    });
                }

                const stats = await fs.stat(outputPath);
                console.log(`\n${chalk.gray('File size:')} ${formatFileSize(stats.size)}`);

                console.log(`\n${chalk.blue('Next steps:')}`);
                console.log(`Run validation and accessibility fixing on the converted file:`);
                console.log(`${chalk.gray(`epub-fix "${outputPath}"`)}`);

            } else {
                spinner.fail('EPUB 2.0 to 3.0 conversion failed');
                console.error(chalk.red('\n❌ Conversion failed:'));
                conversionResult.errors.forEach(error => {
                    console.error(`  • ${error}`);
                });
                process.exit(1);
            }

        } catch (error: any) {
            spinner.fail('Conversion failed');
            console.error(chalk.red(`\nError: ${error.message}`));
            if (options.verbose) {
                console.error(chalk.gray('\nStack trace:'));
                console.error(chalk.gray(error.stack));
            }
            process.exit(1);
        }
    });

// Validate command
program
    .command('validate <input>')
    .description('Only run EPUB validation (no accessibility analysis)')
    .option('-v, --verbose', 'Verbose output')
    .action(async (input: string, options) => {
        const logger = new Logger(options.verbose);

        try {
            if (!isValidEpubPath(input)) {
                console.error(chalk.red(`Error: Invalid EPUB file: ${input}`));
                process.exit(1);
            }

            const processor = new EpubAccessibilityProcessor(logger);
            await processor.initializeTools();

            const cliOptions: CliOptions = {
                input: path.resolve(input),
                analyze: true,
                verbose: options.verbose,
                skipAccessibility: true
            };

            const result = await processor.processEpub(cliOptions, loadConfig());

            console.log(`\nValidation Results:`);
            console.log(`Valid: ${result.validation.valid ? chalk.green('Yes') : chalk.red('No')}`);
            console.log(`Errors: ${chalk.red(result.validation.issues.filter(i => i.type === 'error').length)}`);
            console.log(`Warnings: ${chalk.yellow(result.validation.issues.filter(i => i.type === 'warning').length)}`);

        } catch (error: any) {
            console.error(chalk.red(`Validation failed: ${error.message}`));
            process.exit(1);
        }
    });

// Config command
program
    .command('config')
    .description('Show current configuration')
    .option('-c, --config <path>', 'Path to configuration file')
    .action((options) => {
        const config = loadConfig(options.config);
        console.log(chalk.blue('Current Configuration:'));
        console.log(JSON.stringify(config, null, 2));
    });

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error(chalk.red('\nUncaught Exception:'), error.message);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error(chalk.red('\nUnhandled Rejection:'), reason);
    process.exit(1);
});

// Parse command line arguments
program.parse();