import { ValidationIssue, FixResult, ProcessingContext, EpubContent, AccessibilityIssue } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';

type CheerioStatic = any;

export class LinkAccessibilityFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'Link Accessibility Fixer';
    }

    getHandledCodes(): string[] {
        return [
            'link-name',                    // Links without discernible text
            'link-in-text-block',          // Links not distinguishable in text
            'color-contrast',              // Link color contrast issues
            'focus-order-semantics',       // Link focus issues
            'bypass',                      // Skip links
            'link-text',                   // Generic link text issues
            'empty-link',                  // Links with no text content
            'aria-label',                  // Missing or empty aria-label
            'aria-labelledby',             // Invalid aria-labelledby references
            'missing-title',               // Missing title attributes
            'screen-reader-text',          // Text not visible to screen readers
            'accessible-name',             // Missing accessible name
            'label',                       // General labeling issues
        ];
    }

    canFix(issue: ValidationIssue): boolean {
        // Check handled codes
        const codesMatch = this.getHandledCodes().some(code =>
            issue.code.includes(code) ||
            code.includes(issue.code)
        );

        if (codesMatch) {
            return true;
        }

        // Also check if the message contains accessibility text patterns for links
        const messagePatterns = [
            'Element does not have text that is visible to screen readers',
            'aria-label attribute does not exist or is empty',
            'aria-labelledby attribute does not exist',
            'Element has no title attribute'
        ];

        // Only handle these patterns if the issue involves a link element
        const accessibilityIssue = issue as AccessibilityIssue;
        const isLinkRelated = accessibilityIssue.element === 'a' ||
            issue.message.includes('link') ||
            (issue.location?.file?.includes('link') ?? false);

        return isLinkRelated && messagePatterns.some(pattern => issue.message.includes(pattern));
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing link accessibility issue: ${issue.message}`);

        try {
            const changedFiles: string[] = [];
            let totalFixed = 0;

            // If issue specifies a file, fix only that file
            if (issue.location?.file) {
                const content = this.findContentByPath(context, issue.location.file);
                if (content) {
                    const fixed = await this.fixLinksInFile(content, context, issue);
                    if (fixed) {
                        changedFiles.push(content.path);
                        totalFixed++;
                    }
                }
            } else {
                // Fix all content files that might have link issues
                const contentFiles = this.getAllContentFiles(context);

                for (const content of contentFiles) {
                    const fixed = await this.fixLinksInFile(content, context, issue);
                    if (fixed) {
                        changedFiles.push(content.path);
                        totalFixed++;
                    }
                }
            }

            if (totalFixed > 0) {
                return this.createFixResult(
                    true,
                    `Fixed link accessibility issues in ${totalFixed} files`,
                    changedFiles,
                    { filesFixed: totalFixed }
                );
            } else {
                return this.createFixResult(
                    false,
                    'No link accessibility issues found that could be automatically fixed'
                );
            }

        } catch (error) {
            this.logger.error(`Link accessibility fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix link accessibility: ${error}`);
        }
    }

    private async fixLinksInFile(content: EpubContent, context: ProcessingContext, issue: ValidationIssue): Promise<boolean> {
        const $ = this.loadDocument(content);
        let fixesApplied = false;

        // Find all links that need fixing
        $('a').each((_, link) => {
            const $link = $(link);

            // Fix empty or meaningless link text
            if (this.fixLinkText($link)) {
                fixesApplied = true;
            }

            // Add visual distinction for links
            if (this.addLinkDistinction($link)) {
                fixesApplied = true;
            }

            // Fix missing or poor aria labels
            if (this.fixLinkAria($link)) {
                fixesApplied = true;
            }
        });

        // Add CSS for better link accessibility
        if (this.addLinkAccessibilityCSS($, content)) {
            fixesApplied = true;
        }

        if (fixesApplied) {
            this.saveDocument($, content);
            this.logger.info(`Fixed link accessibility issues in ${content.path}`);
        }

        return fixesApplied;
    }

    private fixLinkText($link: any): boolean {
        const linkText = $link.text().trim();
        const href = $link.attr('href') || '';
        let fixed = false;

        // Check for empty links
        if (!linkText) {
            // Check if link contains images
            const images = $link.find('img');
            if (images.length > 0) {
                // For image links, ensure image has alt text or add aria-label to link
                const img = images.first();
                const alt = img.attr('alt');
                if (!alt || alt.trim() === '') {
                    // Image needs alt text - this will be handled by AltTextFixer
                    // But we can add aria-label to link as fallback
                    const meaningfulText = this.generateLinkText(href);
                    if (meaningfulText) {
                        $link.attr('aria-label', `Image link: ${meaningfulText}`);
                        fixed = true;
                        this.logger.info(`Added aria-label to image link: "Image link: ${meaningfulText}"`);
                    } else {
                        $link.attr('aria-label', 'Image link');
                        fixed = true;
                        this.logger.info(`Added generic aria-label to image link`);
                    }
                }
            } else {
                // Try to generate meaningful text from href
                const meaningfulText = this.generateLinkText(href);
                if (meaningfulText) {
                    $link.text(meaningfulText);
                    fixed = true;
                    this.logger.info(`Added text to empty link: "${meaningfulText}"`);
                } else {
                    // Add aria-label as fallback
                    $link.attr('aria-label', `Link to ${href}`);
                    fixed = true;
                    this.logger.info(`Added aria-label to empty link`);
                }
            }
        }

        // Check for generic/meaningless text
        if (linkText && this.isGenericText(linkText)) {
            // Try to improve the link text
            const improvedText = this.improveLinkText(linkText, href);
            if (improvedText && improvedText !== linkText) {
                $link.text(improvedText);
                fixed = true;
                this.logger.info(`Improved link text from "${linkText}" to "${improvedText}"`);
            } else {
                // Add descriptive aria-label
                const ariaLabel = this.generateDescriptiveLabel(linkText, href);
                $link.attr('aria-label', ariaLabel);
                fixed = true;
                this.logger.info(`Added descriptive aria-label: "${ariaLabel}"`);
            }
        }

        return fixed;
    }

    private addLinkDistinction($link: any): boolean {
        // Add class for CSS styling to distinguish links
        const existingClass = $link.attr('class') || '';

        if (!existingClass.includes('epub-accessible-link')) {
            $link.attr('class', existingClass ? `${existingClass} epub-accessible-link` : 'epub-accessible-link');
            return true;
        }

        return false;
    }

    private fixLinkAria($link: any): boolean {
        const href = $link.attr('href') || '';
        const linkText = $link.text().trim();
        const existingAriaLabel = $link.attr('aria-label');
        const existingAriaLabelledBy = $link.attr('aria-labelledby');
        const existingTitle = $link.attr('title');
        let fixed = false;

        // Check if element has ANY accessible text
        const hasAccessibleText = this.hasAccessibleText($link, linkText, existingAriaLabel, existingAriaLabelledBy);

        if (!hasAccessibleText) {
            // Priority 1: Try to add meaningful aria-label
            const meaningfulLabel = this.generateAccessibleLabel($link, linkText, href);
            if (meaningfulLabel) {
                $link.attr('aria-label', meaningfulLabel);
                fixed = true;
                this.logger.info(`Added aria-label "${meaningfulLabel}" to element without accessible text`);
            }
        }

        // Fix invalid aria-labelledby references
        if (existingAriaLabelledBy && this.hasInvalidAriaLabelledBy($link, existingAriaLabelledBy)) {
            // Remove invalid aria-labelledby and add aria-label instead
            $link.removeAttr('aria-labelledby');
            const fallbackLabel = this.generateAccessibleLabel($link, linkText, href);
            if (fallbackLabel) {
                $link.attr('aria-label', fallbackLabel);
                fixed = true;
                this.logger.info(`Replaced invalid aria-labelledby with aria-label "${fallbackLabel}"`);
            }
        }

        // Add title for additional context if missing and helpful
        if (!existingTitle && href && !existingAriaLabel) {
            const title = this.generateLinkTitle(linkText, href);
            if (title) {
                $link.attr('title', title);
                fixed = true;
                this.logger.info(`Added title "${title}" for additional context`);
            }
        }

        return fixed;
    }

    private generateLinkText(href: string): string {
        if (!href) return '';

        // Remove fragment identifiers and query parameters for cleaner text
        let cleanHref = href.split('#')[0].split('?')[0];

        // Extract filename or meaningful part
        const parts = cleanHref.split('/');
        const lastPart = parts[parts.length - 1];

        if (lastPart && lastPart !== '' && !lastPart.startsWith('http')) {
            // Convert filename to readable text
            return lastPart
                .replace(/\.[^.]+$/, '') // Remove extension
                .replace(/[-_]/g, ' ')   // Replace dashes/underscores with spaces
                .replace(/\b\w/g, l => l.toUpperCase()); // Title case
        }

        // For external links, use domain
        if (href.startsWith('http')) {
            try {
                const url = new URL(href);
                return `Link to ${url.hostname}`;
            } catch {
                return 'External link';
            }
        }

        return '';
    }

    private improveLinkText(currentText: string, href: string): string {
        const generated = this.generateLinkText(href);

        if (generated) {
            // Combine current text with generated text for better context
            if (currentText.toLowerCase() === 'click here') {
                return `Read more about ${generated}`;
            } else if (currentText.toLowerCase() === 'here') {
                return generated;
            } else if (currentText.toLowerCase() === 'read more') {
                return `Read more: ${generated}`;
            } else if (currentText.toLowerCase() === 'more') {
                return `More about ${generated}`;
            }
        }

        return currentText; // Return original if can't improve
    }

    private generateDescriptiveLabel(linkText: string, href: string): string {
        const generated = this.generateLinkText(href);

        if (generated) {
            return `${linkText}: ${generated}`;
        } else {
            return `${linkText} (link to ${href})`;
        }
    }

    private generateLinkTitle(linkText: string, href: string): string {
        if (href.startsWith('http')) {
            return `External link: ${linkText}`;
        } else if (href.startsWith('#')) {
            return `Navigate to section: ${linkText}`;
        } else {
            return `Link to: ${linkText}`;
        }
    }

    private hasAccessibleText($element: any, visibleText: string, ariaLabel?: string, ariaLabelledBy?: string): boolean {
        // Check if element has visible text
        if (visibleText && visibleText.length > 0) {
            return true;
        }

        // Check if it has a valid aria-label
        if (ariaLabel && ariaLabel.trim().length > 0) {
            return true;
        }

        // Check if aria-labelledby references valid elements with text
        if (ariaLabelledBy && this.hasValidAriaLabelledBy($element, ariaLabelledBy)) {
            return true;
        }

        return false;
    }

    private hasValidAriaLabelledBy($element: any, ariaLabelledBy: string): boolean {
        const $ = $element.parent().length > 0 ? $element.parent().parent() : $element;
        const ids = ariaLabelledBy.split(/\s+/);

        for (const id of ids) {
            if (!id.trim()) continue;

            const referencedElement = $(`#${id.trim()}`);
            if (referencedElement.length > 0) {
                const referencedText = referencedElement.text().trim();
                if (referencedText && referencedText.length > 0) {
                    return true; // Found at least one valid reference
                }
            }
        }

        return false; // No valid references found
    }

    private hasInvalidAriaLabelledBy($element: any, ariaLabelledBy: string): boolean {
        return !this.hasValidAriaLabelledBy($element, ariaLabelledBy);
    }

    private generateAccessibleLabel($element: any, visibleText: string, href: string): string {
        // If there's meaningful visible text, use it as base
        if (visibleText && visibleText.length > 0 && !this.isGenericText(visibleText)) {
            return visibleText;
        }

        // Try to generate from href
        const hrefText = this.generateLinkText(href);
        if (hrefText && hrefText !== 'Image') {
            return hrefText;
        }

        // Check for nearby context
        const contextText = this.getContextualText($element);
        if (contextText) {
            return contextText;
        }

        // Check for images within the link
        const images = $element.find('img');
        if (images.length > 0) {
            const img = images.first();
            const alt = img.attr('alt');
            if (alt && alt.trim()) {
                return alt.trim();
            }
            const imgSrc = img.attr('src') || '';
            const imgText = this.generateLinkText(imgSrc);
            if (imgText && imgText !== 'Image') {
                return `Image link: ${imgText}`;
            }
            return 'Image link';
        }

        // Fallback based on href type
        if (href.startsWith('http')) {
            return 'External link';
        } else if (href.startsWith('#')) {
            return 'Internal navigation link';
        } else if (href.includes('mailto:')) {
            return 'Email link';
        } else if (href.includes('tel:')) {
            return 'Phone number link';
        }

        return 'Link';
    }

    private isGenericText(text: string): boolean {
        const genericTexts = [
            'click here', 'here', 'read more', 'more', 'link', 'continue',
            'next', 'previous', 'back', 'forward', 'go', 'view', 'see',
            'download', 'open', 'close', 'submit', 'button'
        ];

        const lowerText = text.toLowerCase().trim();
        return genericTexts.some(generic => lowerText === generic || lowerText.includes(generic));
    }

    private getContextualText($element: any): string {
        // Look for nearby headings
        const nearbyHeading = $element.prevAll('h1, h2, h3, h4, h5, h6').first();
        if (nearbyHeading.length > 0) {
            const headingText = nearbyHeading.text().trim();
            if (headingText && headingText.length < 50) {
                return `Link in section: ${headingText}`;
            }
        }

        // Look for parent context
        const parent = $element.parent();
        if (parent.length > 0) {
            const parentText = parent.text().replace($element.text(), '').trim();
            if (parentText && parentText.length > 0 && parentText.length < 100) {
                // Extract meaningful words (remove common stop words)
                const meaningfulWords = parentText.split(/\s+/)
                    .filter(word => word.length > 3 && !/^(the|and|with|for|from|this|that|will|can|are|was|were|been|have|has|had|but|not|you|your|they|their|what|when|where|how)$/i.test(word))
                    .slice(0, 3)
                    .join(' ');

                if (meaningfulWords) {
                    return `Link related to: ${meaningfulWords}`;
                }
            }
        }

        return '';
    }

    private addLinkAccessibilityCSS($: CheerioStatic, content: EpubContent): boolean {
        // Check if CSS already exists
        if ($('style:contains("epub-accessible-link")').length > 0) {
            return false;
        }

        // Add CSS for better link accessibility
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

/* Skip links for navigation */
.epub-skip-link {
    position: absolute;
    left: -10000px;
    top: auto;
    width: 1px;
    height: 1px;
    overflow: hidden;
}

.epub-skip-link:focus {
    position: static;
    width: auto;
    height: auto;
    background: #000000;
    color: #ffffff;
    padding: 8px;
    text-decoration: none;
    z-index: 999;
}
`;

        // Add to head if exists, otherwise add to body
        const head = $('head');
        if (head.length > 0) {
            head.append(`<style type="text/css">${linkCSS}</style>`);
        } else {
            $('body').prepend(`<style type="text/css">${linkCSS}</style>`);
        }

        return true;
    }
}