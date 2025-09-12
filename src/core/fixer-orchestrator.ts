import { ValidationIssue, FixResult, ProcessingContext } from '../types';
import { Logger } from '../utils/common';
import { BaseFixer } from '../fixers/base-fixer';
import { ValidationStructureFixer } from '../fixers/validation-structure-fixer'; // Add this import
import { MetadataAccessibilityFixer } from '../fixers/metadata-accessibility-fixer'; // Add this import
import { AltTextFixer } from '../fixers/alt-text-fixer';
import { HeadingStructureFixer } from '../fixers/heading-structure-fixer';
import { LanguageAttributeFixer } from '../fixers/language-fixer';
import { MetadataFixer } from '../fixers/metadata-fixer';
import { TitleFixer } from '../fixers/title-fixer';
import { ColorContrastFixer } from '../fixers/color-contrast-fixer';
import { LinkAccessibilityFixer } from '../fixers/link-accessibility-fixer';
import { LinkAccessibilityEnhancedFixer } from '../fixers/link-accessibility-enhanced-fixer';
import { InteractiveElementFixer } from '../fixers/interactive-element-fixer';
import { ResourceReferenceFixer } from '../fixers/resource-reference-fixer';
import { EpubTypeRoleFixer } from '../fixers/epub-type-role-fixer';
import { ScrollableRegionFixer } from '../fixers/scrollable-region-fixer';
import { NonLinearContentFixer } from '../fixers/non-linear-content-fixer';
import { LandmarkUniqueFixer } from '../fixers/landmark-unique-fixer';
import { DataAttributeFixer } from '../fixers/data-attribute-fixer'; // Add this import

export class FixerOrchestrator {
    private logger: Logger;
    private fixers: BaseFixer[] = [];

    constructor(logger: Logger) {
        this.logger = logger;
        this.initializeFixers();
    }

    private initializeFixers(): void {
        this.fixers = [
            new ValidationStructureFixer(this.logger), // Fix structural validation issues first
            new MetadataFixer(this.logger),          // Fix metadata first - foundational
            new MetadataAccessibilityFixer(this.logger), // Fix accessibility metadata
            new LanguageAttributeFixer(this.logger),  // Fix language attributes - affects other fixes
            new TitleFixer(this.logger),             // Fix document titles
            new AltTextFixer(this.logger),           // Fix alt text for images
            new HeadingStructureFixer(this.logger),  // Fix heading structure
            new ColorContrastFixer(this.logger),     // Fix color contrast issues
            new LinkAccessibilityFixer(this.logger), // Fix link accessibility issues
            new LinkAccessibilityEnhancedFixer(this.logger), // Fix enhanced link accessibility issues
            new InteractiveElementFixer(this.logger), // Fix interactive element accessibility
            new ResourceReferenceFixer(this.logger), // Fix remote/missing resource references
            new EpubTypeRoleFixer(this.logger),      // Fix epub:type to ARIA role mappings
            new ScrollableRegionFixer(this.logger),  // Fix scrollable region focusable issues
            new NonLinearContentFixer(this.logger),  // Fix non-linear content reachability
            new LandmarkUniqueFixer(this.logger),    // Fix landmark uniqueness issues
            new DataAttributeFixer(this.logger),     // Fix data attribute issues
            // Add more fixers here as they're implemented
        ];

        this.logger.info(`Initialized ${this.fixers.length} fixers`);
        this.fixers.forEach((fixer, index) => {
            this.logger.info(`Fixer ${index + 1}: ${fixer.getFixerName()}`);
        });
    }

    async fixAllIssues(context: ProcessingContext): Promise<FixResult[]> {
        this.logger.info(`Starting to fix ${context.issues.length} issues`);

        const results: FixResult[] = [];
        const fixableIssues = context.issues.filter(issue => issue.fixable && !issue.fixed);

        this.logger.info(`Found ${fixableIssues.length} fixable issues`);
        
        // Log all fixable issues for debugging
        fixableIssues.forEach((issue, index) => {
            this.logger.info(`Fixable issue ${index + 1}: code="${issue.code}", message="${issue.message}", fixable=${issue.fixable}, fixed=${issue.fixed}, severity=${issue.severity}`);
        });
        
        // Log all issues for debugging
        context.issues.forEach((issue, index) => {
            this.logger.info(`All issues ${index + 1}: code="${issue.code}", message="${issue.message}", fixable=${issue.fixable}, fixed=${issue.fixed}, severity=${issue.severity}`);
        });

        this.logger.info(`Processing ${fixableIssues.length} fixable issues...`);
        let processedCount = 0;
        for (const issue of fixableIssues) {
            processedCount++;
            this.logger.info(`Processing issue ${processedCount}/${fixableIssues.length}: code="${issue.code}", message="${issue.message}", fixed=${issue.fixed}`);
            // Skip if already marked as fixed by duplicate detection
            if (issue.fixed) {
                this.logger.info(`Skipping already fixed issue: ${issue.code} - ${issue.message}`);
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
                } else {
                    this.logger.warn(`Failed to fix issue: ${issue.code} - ${result.message}`);
                    // Don't mark as fixed if the fix failed
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
        this.logger.info(`Attempting to fix issue: code="${issue.code}", message="${issue.message}"`);
        // Find appropriate fixer for this issue
        const fixer = this.findFixerForIssue(issue);

        if (!fixer) {
            this.logger.info(`No fixer found for issue: ${issue.code}`);
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
        this.logger.info(`Marking similar issues as fixed for issue: code="${fixedIssue.code}", message="${fixedIssue.message}"`);
        // Mark similar issues as fixed to avoid duplicate processing
        const fixerForThisIssue = this.findFixerForIssue(fixedIssue);
        if (!fixerForThisIssue) return;

        // Special handling for heading-order issues
        if ((fixedIssue.code.includes('heading-order') || fixedIssue.message.includes('Heading order')) &&
            fixerForThisIssue.getFixerName() === 'Heading Structure Fixer') {
            // When the heading structure fixer successfully fixes issues in a file,
            // mark all heading-order issues in that same file as fixed
            this.logger.info('Processing heading-order issues individually by file');
            
            const sameFileHeadingOrderIssues = context.issues.filter(issue =>
                !issue.fixed &&
                (issue.code.includes('heading-order') || issue.message.includes('Heading order')) &&
                issue.location?.file === fixedIssue.location?.file
            );

            sameFileHeadingOrderIssues.forEach(issue => {
                issue.fixed = true;
                this.logger.info(`Marked heading-order issue as fixed: ${issue.code} in ${issue.location?.file || 'global'}`);
            });
        }
        // For language-related fixes, we should NOT mark all language issues as fixed since they're typically per-file
        // Each file needs to be processed individually
        else if (fixedIssue.code.includes('html-has-lang') ||
            fixedIssue.code.includes('missing-lang') ||
            (fixedIssue.code.includes('RSC-005') && fixedIssue.message.toLowerCase().includes('language')) ||
            fixedIssue.code.includes('epub-lang') ||
            fixedIssue.message.includes('lang attribute')) {
            // Only mark identical issues in the same file as fixed
            const sameFileLanguageIssues = context.issues.filter(issue =>
                !issue.fixed &&
                issue.code === fixedIssue.code &&
                issue.location?.file === fixedIssue.location?.file
            );

            sameFileLanguageIssues.forEach(issue => {
                issue.fixed = true;
                this.logger.info(`Marked identical language issue as fixed: ${issue.code} in ${issue.location?.file || 'global'}`);
            });
        }
        // For validation structure issues, be more careful about marking RSC-005 issues as fixed
        else if (fixedIssue.code.includes('RSC-005') && 
                 fixerForThisIssue.getFixerName() === 'Validation Structure Fixer') {
            // Check if this is an http-equiv issue - these should be handled per-file
            if (fixedIssue.message.toLowerCase().includes('http-equiv')) {
                // Only mark issues in the same file as fixed, not all RSC-005 issues
                // But be more specific - only mark identical http-equiv issues as fixed
                const sameFileHttpEquivIssues = context.issues.filter(issue =>
                    !issue.fixed &&
                    issue.code === fixedIssue.code &&
                    issue.location?.file === fixedIssue.location?.file &&
                    issue.message.toLowerCase().includes('http-equiv')
                );

                sameFileHttpEquivIssues.forEach(issue => {
                    issue.fixed = true;
                    this.logger.info(`Marked http-equiv validation structure issue as fixed: ${issue.code} in ${issue.location?.file || 'global'}`);
                });
            }
            // Check if this is a role attribute issue - these should also be handled per-file
            else if (fixedIssue.message.toLowerCase().includes('role')) {
                // Only mark issues in the same file as fixed, not all RSC-005 issues
                const sameFileRoleIssues = context.issues.filter(issue =>
                    !issue.fixed &&
                    issue.code === fixedIssue.code &&
                    issue.location?.file === fixedIssue.location?.file &&
                    issue.message.toLowerCase().includes('role')
                );

                sameFileRoleIssues.forEach(issue => {
                    issue.fixed = true;
                    this.logger.info(`Marked role validation structure issue as fixed: ${issue.code} in ${issue.location?.file || 'global'}`);
                });
            }
            // Check if this is an xsi:type attribute issue
            else if (fixedIssue.message.toLowerCase().includes('xsi:type') || 
                     (fixedIssue.message.toLowerCase().includes('attribute') && fixedIssue.message.toLowerCase().includes('not allowed'))) {
                // For xsi:type issues, mark similar issues in the OPF file as fixed
                const sameFileXsiTypeIssues = context.issues.filter(issue =>
                    !issue.fixed &&
                    issue.code === fixedIssue.code &&
                    issue.location?.file === fixedIssue.location?.file &&
                    (issue.message.toLowerCase().includes('xsi:type') || 
                     (issue.message.toLowerCase().includes('attribute') && issue.message.toLowerCase().includes('not allowed')))
                );

                sameFileXsiTypeIssues.forEach(issue => {
                    issue.fixed = true;
                    this.logger.info(`Marked xsi:type validation structure issue as fixed: ${issue.code} in ${issue.location?.file || 'global'}`);
                });
            }
            // Check if this is a page-map attribute issue
            else if (fixedIssue.message.toLowerCase().includes('page-map')) {
                // For page-map issues, only mark exact same issues as fixed to avoid over-marking
                // BUT be more specific to avoid marking similar issues incorrectly
                const samePageMapIssues = context.issues.filter(issue =>
                    !issue.fixed &&
                    issue.code === fixedIssue.code &&
                    issue.message.toLowerCase().includes('page-map') &&
                    issue.message.toLowerCase() === fixedIssue.message.toLowerCase()
                );

                samePageMapIssues.forEach(issue => {
                    issue.fixed = true;
                    this.logger.info(`Marked page-map validation structure issue as fixed: ${issue.code} in ${issue.location?.file || 'global'}`);
                });
            }
            // For other RSC-005 issues that were successfully fixed by ValidationStructureFixer, mark exact same issues as fixed
            else {
                const sameIssues = context.issues.filter(issue =>
                    !issue.fixed &&
                    issue.code === fixedIssue.code &&
                    issue.message === fixedIssue.message
                );

                sameIssues.forEach(issue => {
                    issue.fixed = true;
                    this.logger.info(`Marked identical validation structure issue as fixed: ${issue.code} in ${issue.location?.file || 'global'}`);
                });
            }
        }
        // For metadata accessibility issues, mark all related metadata issues as fixed
        // since MetadataFixer handles them comprehensively
        else if ((fixedIssue.code.includes('metadata-') || fixedIssue.code.includes('accessibility')) &&
            fixerForThisIssue.getFixerName() === 'Metadata Fixer') {
            // Mark all metadata accessibility issues in the same file as fixed since MetadataFixer handles them comprehensively
            const metadataIssues = context.issues.filter(issue =>
                !issue.fixed &&
                (issue.code.includes('metadata-') || issue.code.includes('accessibility')) &&
                issue.location?.file === fixedIssue.location?.file
            );

            metadataIssues.forEach(issue => {
                issue.fixed = true;
                this.logger.info(`Marked comprehensive metadata issue as fixed: ${issue.code} in ${issue.location?.file || 'global'}`);
            });
        }
        // Special handling for OPF-096 (non-linear content reachability) issues
        // These issues are related to different non-linear content items but are all fixed by the same process
        else if (fixedIssue.code === 'OPF-096' && 
                 fixerForThisIssue.getFixerName() === 'Non-Linear Content Fixer') {
            // Mark all OPF-096 issues as fixed since the NonLinearContentFixer addresses all non-linear content items at once
            const allOpf096Issues = context.issues.filter(issue =>
                !issue.fixed &&
                issue.code === 'OPF-096'
            );

            allOpf096Issues.forEach(issue => {
                issue.fixed = true;
                this.logger.info(`Marked OPF-096 issue as fixed: ${issue.message}`);
            });
        }
        // Special handling for empty-heading issues
        // These issues should be handled individually, not marked as fixed in bulk
        else if (fixedIssue.code === 'empty-heading' && 
                 fixerForThisIssue.getFixerName() === 'Heading Structure Fixer') {
            // When the heading structure fixer successfully fixes issues in a file,
            // mark all empty-heading issues in that same file as fixed
            this.logger.info('Processing empty-heading issues individually by file');
            
            const sameFileEmptyHeadingIssues = context.issues.filter(issue =>
                !issue.fixed &&
                issue.code === 'empty-heading' &&
                issue.location?.file === fixedIssue.location?.file
            );

            sameFileEmptyHeadingIssues.forEach(issue => {
                issue.fixed = true;
                this.logger.info(`Marked empty-heading issue as fixed: ${issue.code} in ${issue.location?.file || 'global'}`);
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
        this.logger.info(`Finding fixer for issue: code="${issue.code}", message="${issue.message}"`);
        for (const fixer of this.fixers) {
            this.logger.info(`Checking fixer ${fixer.getFixerName()} for issue: ${issue.code} - ${issue.message}`);
            if (fixer.canFix(issue)) {
                this.logger.info(`Found fixer ${fixer.getFixerName()} for issue: ${issue.code} - ${issue.message}`);
                return fixer;
            }
        }
        this.logger.info(`No fixer found for issue: ${issue.code} - ${issue.message}`);
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