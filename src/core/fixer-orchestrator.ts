import { ValidationIssue, FixResult, ProcessingContext } from '../types';
import { Logger } from '../utils/common';
import { BaseFixer } from '../fixers/base-fixer';
import { AltTextFixer } from '../fixers/alt-text-fixer';
import { HeadingStructureFixer } from '../fixers/heading-structure-fixer';
import { LanguageAttributeFixer } from '../fixers/language-fixer';
import { MetadataFixer } from '../fixers/metadata-fixer';
import { TitleFixer } from '../fixers/title-fixer';
import { ColorContrastFixer } from '../fixers/color-contrast-fixer';
import { LinkAccessibilityFixer } from '../fixers/link-accessibility-fixer';
import { InteractiveElementFixer } from '../fixers/interactive-element-fixer';
import { ResourceReferenceFixer } from '../fixers/resource-reference-fixer';

export class FixerOrchestrator {
    private logger: Logger;
    private fixers: BaseFixer[] = [];

    constructor(logger: Logger) {
        this.logger = logger;
        this.initializeFixers();
    }

    private initializeFixers(): void {
        this.fixers = [
            new MetadataFixer(this.logger),          // Fix metadata first - foundational
            new LanguageAttributeFixer(this.logger),  // Fix language attributes - affects other fixes
            new TitleFixer(this.logger),             // Fix document titles
            new AltTextFixer(this.logger),           // Fix alt text for images
            new HeadingStructureFixer(this.logger),  // Fix heading structure
            new ColorContrastFixer(this.logger),     // Fix color contrast issues
            new LinkAccessibilityFixer(this.logger), // Fix link accessibility issues
            new InteractiveElementFixer(this.logger), // Fix interactive element accessibility
            new ResourceReferenceFixer(this.logger), // Fix remote/missing resource references
            // Add more fixers here as they're implemented
        ];

        this.logger.info(`Initialized ${this.fixers.length} fixers`);
    }

    async fixAllIssues(context: ProcessingContext): Promise<FixResult[]> {
        this.logger.info(`Starting to fix ${context.issues.length} issues`);

        const results: FixResult[] = [];
        const fixableIssues = context.issues.filter(issue => issue.fixable && !issue.fixed);

        this.logger.info(`Found ${fixableIssues.length} fixable issues`);

        for (const issue of fixableIssues) {
            // Skip if already marked as fixed by duplicate detection
            if (issue.fixed) {
                this.logger.info(`Skipping already fixed issue: ${issue.code}`);
                continue;
            }

            try {
                const result = await this.fixIssue(issue, context);
                results.push(result);

                if (result.success) {
                    issue.fixed = true;
                    context.fixes.push(result);

                    // Mark similar issues as fixed to avoid duplicate processing
                    this.markSimilarIssuesFixed(issue, context);
                }
            } catch (error) {
                this.logger.error(`Failed to fix issue ${issue.code}: ${error}`);
                results.push({
                    success: false,
                    message: `Failed to fix ${issue.code}: ${error}`,
                    details: { issueCode: issue.code, error: String(error) }
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        this.logger.success(`Fixed ${successCount} out of ${fixableIssues.length} fixable issues`);

        return results;
    }

    async fixIssue(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        // Find appropriate fixer for this issue
        const fixer = this.findFixerForIssue(issue);

        if (!fixer) {
            return {
                success: false,
                message: `No fixer available for issue: ${issue.code}`,
                details: { issueCode: issue.code }
            };
        }

        this.logger.info(`Using ${fixer.getFixerName()} to fix: ${issue.code}`);

        try {
            const result = await fixer.fix(issue, context);

            if (result.success) {
                this.logger.success(`Successfully fixed: ${issue.message}`);
            } else {
                this.logger.warn(`Fix failed: ${result.message}`);
            }

            return result;
        } catch (error) {
            this.logger.error(`Fixer ${fixer.getFixerName()} threw error: ${error}`);
            return {
                success: false,
                message: `Fixer error: ${error}`,
                details: { fixer: fixer.getFixerName(), error: String(error) }
            };
        }
    }

    private markSimilarIssuesFixed(fixedIssue: ValidationIssue, context: ProcessingContext): void {
        // Mark similar issues as fixed to avoid duplicate processing
        const fixerForThisIssue = this.findFixerForIssue(fixedIssue);
        if (!fixerForThisIssue) return;

        // For language-related fixes, mark all language issues as fixed since they're typically global
        if (fixedIssue.code.includes('html-has-lang') ||
            fixedIssue.code.includes('missing-lang') ||
            fixedIssue.code.includes('RSC-005') ||
            fixedIssue.code.includes('epub-lang')) {
            const languageIssues = context.issues.filter(issue =>
                !issue.fixed &&
                (issue.code.includes('html-has-lang') ||
                    issue.code.includes('missing-lang') ||
                    issue.code.includes('RSC-005') ||
                    issue.code.includes('epub-lang'))
            );

            languageIssues.forEach(issue => {
                issue.fixed = true;
                this.logger.info(`Marked similar language issue as fixed: ${issue.code} in ${issue.location?.file || 'global'}`);
            });
        }
        // DO NOT mark metadata accessibility issues as similar - each needs individual processing
        // EXCEPT if this is a comprehensive metadata fix, then mark all related metadata issues as fixed
        else if (fixedIssue.code.includes('metadata-') &&
            fixerForThisIssue.getFixerName() === 'Metadata Fixer') {
            // Mark all metadata accessibility issues in the same file as fixed since MetadataFixer handles them comprehensively
            const metadataIssues = context.issues.filter(issue =>
                !issue.fixed &&
                issue.code.includes('metadata-') &&
                issue.location?.file === fixedIssue.location?.file
            );

            metadataIssues.forEach(issue => {
                issue.fixed = true;
                this.logger.info(`Marked comprehensive metadata issue as fixed: ${issue.code} in ${issue.location?.file || 'global'}`);
            });
        }
        else {
            // For other non-accessibility-metadata issues, mark similar issues in the same file as fixed
            if (fixedIssue.location?.file) {
                const sameFileIssues = context.issues.filter(issue =>
                    !issue.fixed &&
                    issue.code === fixedIssue.code &&
                    issue.location?.file === fixedIssue.location?.file
                );

                sameFileIssues.forEach(issue => {
                    issue.fixed = true;
                    this.logger.info(`Marked similar issue as fixed: ${issue.code} in ${issue.location?.file}`);
                });
            }
        }
    }

    private findFixerForIssue(issue: ValidationIssue): BaseFixer | null {
        for (const fixer of this.fixers) {
            if (fixer.canFix(issue)) {
                return fixer;
            }
        }
        return null;
    }

    getAvailableFixers(): string[] {
        return this.fixers.map(fixer => fixer.getFixerName());
    }

    getHandledCodes(): string[] {
        const codes: string[] = [];
        for (const fixer of this.fixers) {
            codes.push(...fixer.getHandledCodes());
        }
        return [...new Set(codes)]; // Remove duplicates
    }

    async performDryRun(context: ProcessingContext): Promise<{
        fixableIssues: ValidationIssue[];
        unfixableIssues: ValidationIssue[];
        fixerAssignments: { [code: string]: string };
    }> {
        const fixableIssues: ValidationIssue[] = [];
        const unfixableIssues: ValidationIssue[] = [];
        const fixerAssignments: { [code: string]: string } = {};

        for (const issue of context.issues) {
            const fixer = this.findFixerForIssue(issue);

            if (fixer && issue.fixable) {
                fixableIssues.push(issue);
                fixerAssignments[issue.code] = fixer.getFixerName();
            } else {
                unfixableIssues.push(issue);
            }
        }

        this.logger.info(`Dry run complete: ${fixableIssues.length} fixable, ${unfixableIssues.length} unfixable`);

        return {
            fixableIssues,
            unfixableIssues,
            fixerAssignments
        };
    }

    async validateFixes(context: ProcessingContext): Promise<{
        validatedFiles: string[];
        errors: string[];
    }> {
        const validatedFiles: string[] = [];
        const errors: string[] = [];

        // Basic validation of modified content
        for (const [path, content] of context.contents) {
            if (content.modified) {
                try {
                    // Basic XML/HTML validation
                    if (content.mediaType === 'application/xhtml+xml' || content.mediaType === 'text/html') {
                        const cheerio = require('cheerio');
                        cheerio.load(content.content, { xmlMode: true });
                        validatedFiles.push(path);
                    }
                } catch (error) {
                    errors.push(`Validation error in ${path}: ${error}`);
                    this.logger.error(`Validation error in ${path}: ${error}`);
                }
            }
        }

        if (errors.length === 0) {
            this.logger.success(`All ${validatedFiles.length} modified files passed validation`);
        } else {
            this.logger.error(`${errors.length} files failed validation`);
        }

        return { validatedFiles, errors };
    }
}