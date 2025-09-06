import { ValidationIssue, FixResult, ProcessingContext, EpubContent, FixDetail } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';

type CheerioStatic = any;

export class LinkAccessibilityEnhancedFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'Link Accessibility Enhanced Fixer';
    }

    getHandledCodes(): string[] {
        return [
            'link-name',
            'link-in-text-block'
        ];
    }

    canFix(issue: ValidationIssue): boolean {
        const handledCodes = this.getHandledCodes();
        const issueCodeLower = issue.code.toLowerCase();
        const issueMessageLower = issue.message.toLowerCase();

        // Debug logging
        this.logger.info(`LinkAccessibilityEnhancedFixer checking issue: code="${issue.code}", message="${issue.message}"`);

        // Check direct code matches
        if (handledCodes.some(code => issueCodeLower.includes(code.toLowerCase()) || code.toLowerCase().includes(issueCodeLower))) {
            this.logger.info(`LinkAccessibilityEnhancedFixer can fix issue: matched by code`);
            return true;
        }

        // Check specific error message patterns we can fix
        const fixableMessages = [
            'link has no discernible text',
            'link text is not descriptive',
            'link in text block',
            'link name',
            'insufficient color contrast',
            'no styling',
            'distinguish it from the surrounding text'
        ];

        const canFix = fixableMessages.some(pattern => issueMessageLower.includes(pattern.toLowerCase()));
        if (canFix) {
            this.logger.info(`LinkAccessibilityEnhancedFixer can fix issue: matched by message content`);
        } else {
            this.logger.info(`LinkAccessibilityEnhancedFixer cannot fix issue`);
        }

        return canFix;
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing link accessibility issue: ${issue.message}`);
        this.logger.info(`Issue code: ${issue.code}`);

        try {
            // Handle different types of link accessibility issues and collect fix details in one pass
            if (issue.code === 'link-name' || issue.message.includes('link has no discernible text')) {
                this.logger.info(`Handling link-name issue`);
                return await this.fixLinkNameIssues(issue, context);
            } else if (issue.code === 'link-in-text-block' || issue.message.includes('link in text block')) {
                this.logger.info(`Handling link-in-text-block issue`);
                return await this.fixLinkInTextBlockIssues(issue, context);
            } else {
                this.logger.info(`No handler found for this link accessibility issue`);
                return this.createFixResult(
                    false,
                    `Could not fix link accessibility issue: ${issue.code}`
                );
            }

        } catch (error) {
            this.logger.error(`Link accessibility fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix link accessibility: ${error}`);
        }
    }

    /**
     * Fix link name issues by adding descriptive text or aria-labels
     */
    private async fixLinkNameIssues(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        const changedFiles: string[] = [];
        let totalFixed = 0;
        const fixDetails: FixDetail[] = [];

        // If issue specifies a file, fix only that file
        if (issue.location?.file) {
            const content = this.findContentByPath(context, issue.location.file);
            if (content) {
                const { fixed, details } = await this.fixLinkNamesInFile(content);
                if (fixed > 0) {
                    changedFiles.push(content.path);
                    totalFixed += fixed;
                    fixDetails.push(...details);
                }
            }
        } else {
            // Fix all content files
            const contentFiles = this.getAllContentFiles(context);
            for (const content of contentFiles) {
                const { fixed, details } = await this.fixLinkNamesInFile(content);
                if (fixed > 0) {
                    changedFiles.push(content.path);
                    totalFixed += fixed;
                    fixDetails.push(...details);
                }
            }
        }

        if (totalFixed > 0) {
            return this.createFixResult(
                true,
                `Fixed link name issues in ${totalFixed} links`,
                changedFiles,
                { linksFixed: totalFixed, fixDetails }
            );
        }

        return this.createFixResult(false, 'No link name issues found to fix');
    }

    /**
     * Fix link-in-text-block issues by adding appropriate styling or context
     */
    private async fixLinkInTextBlockIssues(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        const changedFiles: string[] = [];
        let totalFixed = 0;
        const fixDetails: FixDetail[] = [];

        // If issue specifies a file, fix only that file
        if (issue.location?.file) {
            const content = this.findContentByPath(context, issue.location.file);
            if (content) {
                const { fixed, details } = await this.fixLinkInTextBlockInFile(content);
                if (fixed > 0) {
                    changedFiles.push(content.path);
                    totalFixed += fixed;
                    fixDetails.push(...details);
                }
            }
        } else {
            // Fix all content files
            const contentFiles = this.getAllContentFiles(context);
            for (const content of contentFiles) {
                const { fixed, details } = await this.fixLinkInTextBlockInFile(content);
                if (fixed > 0) {
                    changedFiles.push(content.path);
                    totalFixed += fixed;
                    fixDetails.push(...details);
                }
            }
        }

        if (totalFixed > 0) {
            return this.createFixResult(
                true,
                `Fixed link in text block issues in ${totalFixed} links`,
                changedFiles,
                { linksFixed: totalFixed, fixDetails }
            );
        }

        return this.createFixResult(false, 'No link in text block issues found to fix');
    }

    /**
     * Fix link names in a single file
     */
    private async fixLinkNamesInFile(content: EpubContent): Promise<{ fixed: number; details: FixDetail[] }> {
        const $ = this.loadDocument(content);
        let fixedCount = 0;
        const fixDetails: FixDetail[] = [];

        // Find links with no text content
        $('a').each((_, element) => {
            const $element = $(element);
            
            // Check if link has no text content
            const textContent = $element.text().trim();
            const ariaLabel = $element.attr('aria-label');
            const title = $element.attr('title');
            
            if (!textContent && !ariaLabel && !title) {
                // Try to get href as fallback text
                const href = $element.attr('href');
                if (href) {
                    const originalHtml = $.html($element);
                    
                    // For fragment links, try to find the target element's text
                    if (href.startsWith('#')) {
                        const targetId = href.substring(1);
                        const targetElement = $(`#${targetId}`);
                        if (targetElement.length > 0) {
                            const targetText = targetElement.text().trim();
                            if (targetText) {
                                $element.attr('aria-label', targetText);
                                fixedCount++;
                                const fixedHtml = $.html($element);
                                fixDetails.push({
                                    filePath: content.path,
                                    originalContent: originalHtml,
                                    fixedContent: fixedHtml,
                                    explanation: `Added aria-label="${targetText}" to link with href="${href}"`,
                                    element: 'a',
                                    attribute: 'aria-label',
                                    oldValue: undefined,
                                    newValue: targetText,
                                    issueCode: 'link-name',
                                    selector: `a[href="${href}"]`
                                });
                                this.logger.info(`Added aria-label="${targetText}" to link with href="${href}" in ${content.path}`);
                                return;
                            }
                        }
                    }
                    
                    // For other links, use a generic description
                    const linkDescription = href.includes('http') ? 'External link' : 'Link';
                    $element.attr('aria-label', linkDescription);
                    fixedCount++;
                    const fixedHtml = $.html($element);
                    fixDetails.push({
                        filePath: content.path,
                        originalContent: originalHtml,
                        fixedContent: fixedHtml,
                        explanation: `Added aria-label="${linkDescription}" to link with href="${href}"`,
                        element: 'a',
                        attribute: 'aria-label',
                        oldValue: undefined,
                        newValue: linkDescription,
                        issueCode: 'link-name',  // Add issue code
                        selector: `a[href="${href}"]`  // Add selector
                    });
                    this.logger.info(`Added aria-label="${linkDescription}" to link with href="${href}" in ${content.path}`);
                }
            }
        });

        if (fixedCount > 0) {
            this.saveDocument($, content);
        }

        return { fixed: fixedCount, details: fixDetails };
    }

    /**
     * Fix link in text block issues in a single file
     */
    private async fixLinkInTextBlockInFile(content: EpubContent): Promise<{ fixed: number; details: FixDetail[] }> {
        const $ = this.loadDocument(content);
        let fixedCount = 0;
        const fixDetails: FixDetail[] = [];

        // Find links that might be problematic in text blocks
        $('a').each((_, element) => {
            const $element = $(element);
            const originalHtml = $.html($element);
            
            // Add class for CSS styling to distinguish links
            const existingClass = $element.attr('class') || '';
            if (!existingClass.includes('epub-accessible-link')) {
                const newClass = existingClass ? `${existingClass} epub-accessible-link` : 'epub-accessible-link';
                $element.attr('class', newClass);
                fixedCount++;
                
                const fixedHtml = $.html($element);
                fixDetails.push({
                    filePath: content.path,
                    originalContent: originalHtml,
                    fixedContent: fixedHtml,
                    explanation: `Added CSS class for better link visibility`,
                    element: 'a',
                    attribute: 'class',
                    oldValue: existingClass || undefined,
                    newValue: newClass,
                    issueCode: 'link-in-text-block'  // Add issue code
                });
                this.logger.info(`Added CSS class to link in ${content.path}`);
            }
            
            // Add underline style directly if not already present
            const existingStyle = $element.attr('style') || '';
            if (!existingStyle.includes('text-decoration') && !existingStyle.includes('underline')) {
                const newStyle = existingStyle ? `${existingStyle}; text-decoration: underline` : 'text-decoration: underline';
                $element.attr('style', newStyle);
                fixedCount++;
                
                const fixedHtml = $.html($element);
                fixDetails.push({
                    filePath: content.path,
                    originalContent: originalHtml,
                    fixedContent: fixedHtml,
                    explanation: `Added underline style for better link visibility`,
                    element: 'a',
                    attribute: 'style',
                    oldValue: existingStyle || undefined,
                    newValue: newStyle,
                    issueCode: 'link-in-text-block'  // Add issue code
                });
                this.logger.info(`Added underline style to link in ${content.path}`);
            }
        });

        // Add CSS for better link accessibility if not already present
        if ($('style:contains("epub-accessible-link")').length === 0) {
            const linkCSS = `
/* EPUB Accessibility: Enhanced Link Styling */
.epub-accessible-link {
    /* Ensure links are distinguishable without relying on color alone */
    text-decoration: underline !important;
    color: #0066cc !important;
    border-bottom: 1px solid transparent;
    transition: all 0.2s ease;
}

.epub-accessible-link:hover,
.epub-accessible-link:focus {
    /* Clear visual indication on hover/focus */
    background-color: #e6f3ff !important;
    border-bottom-color: #0066cc !important;
    outline: 2px solid #0066cc;
    outline-offset: 2px;
}

.epub-accessible-link:visited {
    color: #663399 !important;
}

/* Ensure sufficient contrast for all link states */
.epub-accessible-link:active {
    background-color: #cce6ff !important;
    color: #004499 !important;
}
`;
            // Add to head if exists, otherwise add to body
            const head = $('head');
            if (head.length > 0) {
                head.append(`<style>${linkCSS}</style>`);
            } else {
                $('body').prepend(`<style>${linkCSS}</style>`);
            }
            fixedCount++;
            
            fixDetails.push({
                filePath: content.path,
                explanation: `Added CSS for enhanced link accessibility`,
                element: 'style',
                issueCode: 'link-in-text-block'  // Add issue code
            });
            this.logger.info(`Added CSS for enhanced link accessibility to ${content.path}`);
        }

        if (fixedCount > 0) {
            this.saveDocument($, content);
        }

        return { fixed: fixedCount, details: fixDetails };
    }
}