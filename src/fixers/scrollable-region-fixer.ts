import { ValidationIssue, FixResult, ProcessingContext, EpubContent, FixDetail } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';

type Cheerio = any;
type CheerioStatic = any;

export class ScrollableRegionFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'Scrollable Region Fixer';
    }

    getHandledCodes(): string[] {
        return ['scrollable-region-focusable'];
    }

    canFix(issue: ValidationIssue): boolean {
        // Check direct code matches
        const codeMatch = this.getHandledCodes().some(code => 
            issue.code.includes(code) || code.includes(issue.code)
        );
        
        // Check for message patterns that indicate scrollable region focusable issues
        const messagePatterns = [
            'Scrollable region must have keyboard access',
            'scrollable-region-focusable',
            'Scrollable region must have keyboard access',
            'Element should have focusable content',
            'Element should be focusable',
            'Elements that have scrollable content must be accessible by keyboard',
            'Ensure elements that have scrollable content are accessible by keyboard',  // DAISY ACE specific message
            'Element has overflow and is scrollable, but is not keyboard accessible',  // DAISY ACE specific message
            'Element is scrollable but is not keyboard accessible'  // DAISY ACE specific message
        ];
        
        const messageMatch = messagePatterns.some(pattern => 
            issue.message.toLowerCase().includes(pattern.toLowerCase())
        );
        
        const canFix = codeMatch || messageMatch;
        this.logger.info(`ScrollableRegionFixer can fix issue: ${canFix} (codeMatch: ${codeMatch}, messageMatch: ${messageMatch})`);
        this.logger.info(`Issue code: "${issue.code}", message: "${issue.message}"`);
        
        return canFix;
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing scrollable region focusable issue: ${issue.message}`);

        try {
            const changedFiles: string[] = [];
            const fixDetails: FixDetail[] = [];
            let totalFixed = 0;

            // If issue specifies a file, fix only that file
            if (issue.location?.file) {
                this.logger.info(`Issue specifies specific file: ${issue.location.file}`);
                const content = this.findContentByPath(context, issue.location.file);
                
                if (content) {
                    this.logger.info(`Found content for file: ${content.path}`);
                    const fixed = await this.fixScrollableRegionsInFile(content, context);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                        this.logger.info(`Successfully fixed ${fixed} scrollable regions in ${content.path}`);
                    }
                } else {
                    this.logger.warn(`Could not find specific file ${issue.location.file}`);
                }
            } else {
                // Fix all content files
                const contentFiles = this.getAllContentFiles(context);
                this.logger.info(`Found ${contentFiles.length} content files to check`);

                for (const content of contentFiles) {
                    const fixed = await this.fixScrollableRegionsInFile(content, context);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                        this.logger.info(`Fixed ${fixed} scrollable regions in ${content.path}`);
                    }
                }
            }

            if (totalFixed > 0) {
                return this.createFixResult(
                    true,
                    `Added keyboard accessibility to ${totalFixed} scrollable regions`,
                    changedFiles,
                    { regionsFixed: totalFixed }
                );
            } else {
                return this.createFixResult(
                    false,
                    'No scrollable regions found that needed keyboard accessibility fixes'
                );
            }

        } catch (error) {
            this.logger.error(`Scrollable region fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix scrollable regions: ${error}`);
        }
    }

    private async fixScrollableRegionsInFile(content: EpubContent, context: ProcessingContext): Promise<number> {
        const $ = this.loadDocument(content);
        let fixedCount = 0;

        // Find elements that are likely to be scrollable regions
        // These are typically elements with overflow properties set to scroll or auto
        const scrollableSelectors = [
            '[style*="overflow"]',
            '[style*="overflow-x"]',
            '[style*="overflow-y"]',
            '.scrollable',
            '.scrolling',
            '.overflow',
            '.divTable',  // Add specific class from DAISY ACE report
            '.divTableWrapper',  // Add related classes
            '.table-container',  // Add common table container classes
            '.scroll-container',  // Add common scroll container classes
            '[class*="divTable"]', // Catch variations of divTable classes
            '[class*="table"]', // Catch other table-related classes
            '.multiColumn' // Add multiColumn class which can be scrollable
        ];

        // Also check for elements with explicit overflow styles
        const elements = $(scrollableSelectors.join(', ')).toArray();
        
        this.logger.info(`Found ${elements.length} potential scrollable elements with selectors: ${scrollableSelectors.join(', ')}`);
        
        for (const element of elements) {
            const $element = $(element);
            const style = $element.attr('style') || '';
            const className = $element.attr('class') || '';
            
            // Check if the element has overflow properties that indicate it's scrollable
            const isScrollable = style.includes('overflow:') || 
                                style.includes('overflow-x:') || 
                                style.includes('overflow-y:') ||
                                $element.hasClass('scrollable') ||
                                $element.hasClass('scrolling') ||
                                $element.hasClass('overflow') ||
                                $element.hasClass('divTable') ||  // DAISY ACE specific class
                                $element.hasClass('divTableWrapper') ||  // DAISY ACE related class
                                $element.hasClass('table-container') ||
                                $element.hasClass('scroll-container') ||
                                $element.hasClass('multiColumn') ||  // Multi-column content can be scrollable
                                className.includes('divTable') || // Handle variations
                                className.includes('table') ||
                                className.includes('multiColumn');
            
            // Skip if already has tabindex or role that provides focusability
            const hasTabIndex = $element.attr('tabindex') !== undefined;
            const hasRole = $element.attr('role') !== undefined;
            
            this.logger.info(`Checking element: tag=${$element.prop('tagName')}, class="${className}", style="${style}", isScrollable=${isScrollable}, hasTabIndex=${hasTabIndex}, hasRole=${hasRole}`);
            
            if (isScrollable && !hasTabIndex && !hasRole) {
                // Add tabindex="0" to make the element focusable
                $element.attr('tabindex', '0');
                
                // Add aria-label if it doesn't have one
                if (!$element.attr('aria-label') && !$element.attr('aria-labelledby')) {
                    // Generate a more specific aria-label based on class names
                    let ariaLabel = 'Scrollable content region';
                    if (className.includes('divTable')) {
                        ariaLabel = 'Scrollable table content';
                    } else if (className.includes('table-container') || className.includes('table')) {
                        ariaLabel = 'Scrollable table container';
                    } else if (className.includes('divTableWrapper')) {
                        ariaLabel = 'Scrollable table wrapper';
                    } else if (className.includes('scroll')) {
                        ariaLabel = 'Scrollable content area';
                    } else if (className.includes('multiColumn')) {
                        ariaLabel = 'Multi-column content area';
                    }
                    $element.attr('aria-label', ariaLabel);
                }
                
                // Add role if appropriate
                if (!$element.attr('role')) {
                    $element.attr('role', 'region');
                }
                
                fixedCount++;
                this.logger.info(`Made scrollable region focusable: ${$element.prop('tagName')} with class "${className}" in ${content.path}`);
            }
        }

        // Also check for pre elements which are commonly scrollable
        const preElements = $('pre').toArray();
        for (const element of preElements) {
            const $element = $(element);
            
            // Skip if already has tabindex
            if ($element.attr('tabindex') === undefined) {
                // Add tabindex="0" to make the element focusable
                $element.attr('tabindex', '0');
                
                // Add aria-label if it doesn't have one
                if (!$element.attr('aria-label') && !$element.attr('aria-labelledby')) {
                    $element.attr('aria-label', 'Code block');
                }
                
                fixedCount++;
                this.logger.info(`Made pre element focusable: pre in ${content.path}`);
            }
        }

        // Additional fix for div elements with overflow properties that might be missed
        $('div').each((_, element) => {
            const $element = $(element);
            const style = $element.attr('style') || '';
            const className = $element.attr('class') || '';
            
            // Check for overflow properties that indicate scrollable content
            const hasOverflow = style.includes('overflow:') && 
                               (style.includes('scroll') || style.includes('auto'));
            
            // Skip if already has tabindex or role that provides focusability
            const hasTabIndex = $element.attr('tabindex') !== undefined;
            const hasRole = $element.attr('role') !== undefined;
            
            // Also check for divTable class which is common in EPUBs
            const hasDivTableClass = className.includes('divTable');
            
            this.logger.info(`Checking div element: class="${className}", style="${style}", hasOverflow=${hasOverflow}, hasDivTableClass=${hasDivTableClass}, hasTabIndex=${hasTabIndex}, hasRole=${hasRole}`);
            
            if ((hasOverflow || hasDivTableClass) && !hasTabIndex && !hasRole) {
                // Add tabindex="0" to make the element focusable
                $element.attr('tabindex', '0');
                
                // Add aria-label if it doesn't have one
                if (!$element.attr('aria-label') && !$element.attr('aria-labelledby')) {
                    let ariaLabel = 'Scrollable content region';
                    if (className.includes('divTable')) {
                        ariaLabel = 'Scrollable table content';
                    }
                    $element.attr('aria-label', ariaLabel);
                }
                
                // Add role if appropriate
                if (!$element.attr('role')) {
                    $element.attr('role', 'region');
                }
                
                fixedCount++;
                this.logger.info(`Made div with overflow properties focusable: div with class "${className}" in ${content.path}`);
            }
        });

        if (fixedCount > 0) {
            this.saveDocument($, content);
            this.logger.info(`Fixed ${fixedCount} scrollable regions in ${content.path}`);
        }

        return fixedCount;
    }
}