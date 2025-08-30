import { ValidationIssue, FixResult, ProcessingContext, EpubContent } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';

type CheerioStatic = any;

export class ColorContrastFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'Color Contrast Fixer';
    }

    getHandledCodes(): string[] {
        return [
            'color-contrast',           // Standard color contrast issues
            'color-contrast-enhanced',  // Enhanced contrast requirements
            'contrast-ratio',           // General contrast ratio issues
        ];
    }

    canFix(issue: ValidationIssue): boolean {
        return this.getHandledCodes().some(code => issue.code.includes(code) || code.includes(issue.code));
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing color contrast issue: ${issue.message}`);

        try {
            const changedFiles: string[] = [];
            let totalFixed = 0;

            // If issue specifies a file, fix only that file
            if (issue.location?.file) {
                const content = this.findContentByPath(context, issue.location.file);
                if (content) {
                    const fixed = await this.fixColorContrastInFile(content, context, issue);
                    if (fixed) {
                        changedFiles.push(content.path);
                        totalFixed++;
                    }
                }
            } else {
                // Fix all content files that might have contrast issues
                const contentFiles = this.getAllContentFiles(context);

                for (const content of contentFiles) {
                    const fixed = await this.fixColorContrastInFile(content, context, issue);
                    if (fixed) {
                        changedFiles.push(content.path);
                        totalFixed++;
                    }
                }
            }

            if (totalFixed > 0) {
                return this.createFixResult(
                    true,
                    `Fixed color contrast issues in ${totalFixed} files`,
                    changedFiles,
                    { elementsFixed: totalFixed }
                );
            } else {
                return this.createFixResult(
                    false,
                    'No color contrast issues found that could be automatically fixed'
                );
            }

        } catch (error) {
            this.logger.error(`Color contrast fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix color contrast: ${error}`);
        }
    }

    private async fixColorContrastInFile(content: EpubContent, context: ProcessingContext, issue: ValidationIssue): Promise<boolean> {
        const $ = this.loadDocument(content);
        let fixesApplied = false;

        // Find elements with poor color contrast
        const elementsToFix = this.findLowContrastElements($, issue);

        for (const element of elementsToFix) {
            const $element = $(element);

            // Fix inline styles
            if (this.fixInlineColorContrast($element)) {
                fixesApplied = true;
                this.logger.info(`Fixed inline color contrast in ${content.path}`);
            }

            // Add warning classes for CSS-based fixes
            if (this.addContrastWarningClass($element)) {
                fixesApplied = true;
                this.logger.info(`Added contrast warning class in ${content.path}`);
            }
        }

        // Add CSS for better contrast defaults
        if (this.addContrastCSS($, content)) {
            fixesApplied = true;
            this.logger.info(`Added contrast CSS to ${content.path}`);
        }

        if (fixesApplied) {
            this.saveDocument($, content);
        }

        return fixesApplied;
    }

    private findLowContrastElements($: CheerioStatic, issue: ValidationIssue): any[] {
        const elements: any[] = [];

        // Check if this is an accessibility issue with element info
        const accessibilityIssue = issue as any;
        if (accessibilityIssue.element) {
            $(accessibilityIssue.element).each((_, el) => elements.push(el));
        } else {
            // Common elements that often have contrast issues
            $('p, span, div, a, h1, h2, h3, h4, h5, h6').each((_, el) => {
                const $el = $(el);
                if (this.hasLowContrast($el)) {
                    elements.push(el);
                }
            });
        }

        return elements;
    }

    private hasLowContrast($element: any): boolean {
        const style = $element.attr('style') || '';

        // Check for common low contrast patterns
        const lowContrastPatterns = [
            /color:\s*#?([a-f0-9]{3,6})/i,
            /background.*color:\s*#?([a-f0-9]{3,6})/i
        ];

        return lowContrastPatterns.some(pattern => {
            const match = style.match(pattern);
            if (match) {
                // Simple heuristic: very light colors on light backgrounds
                const color = match[1].toLowerCase();
                return this.isLightColor(color);
            }
            return false;
        });
    }

    private isLightColor(hexColor: string): boolean {
        // Convert hex to RGB and calculate brightness
        let color = hexColor.replace('#', '');

        // Handle 3-digit hex
        if (color.length === 3) {
            color = color.split('').map(c => c + c).join('');
        }

        const r = parseInt(color.substr(0, 2), 16);
        const g = parseInt(color.substr(2, 2), 16);
        const b = parseInt(color.substr(4, 2), 16);

        // Calculate perceived brightness
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;

        // Consider colors with brightness > 180 as "light"
        return brightness > 180;
    }

    private fixInlineColorContrast($element: any): boolean {
        const style = $element.attr('style') || '';
        let newStyle = style;
        let fixed = false;

        // Fix light gray text
        newStyle = newStyle.replace(/color:\s*#?(ccc|ddd|eee|f0f0f0|lightgray|lightgrey)/gi, 'color: #333333');

        // Fix very light colors
        newStyle = newStyle.replace(/color:\s*#?([a-f0-9]{6})/gi, (match, color) => {
            if (this.isLightColor(color)) {
                fixed = true;
                return 'color: #333333'; // Dark gray for better contrast
            }
            return match;
        });

        if (newStyle !== style) {
            $element.attr('style', newStyle);
            fixed = true;
        }

        return fixed;
    }

    private addContrastWarningClass($element: any): boolean {
        // Add a class that can be styled with CSS for better contrast
        const existingClass = $element.attr('class') || '';

        if (!existingClass.includes('epub-contrast-fix')) {
            $element.attr('class', existingClass ? `${existingClass} epub-contrast-fix` : 'epub-contrast-fix');
            return true;
        }

        return false;
    }

    private addContrastCSS($: CheerioStatic, content: EpubContent): boolean {
        // Check if CSS already exists
        if ($('style:contains("epub-contrast-fix")').length > 0) {
            return false;
        }

        // Add CSS for better contrast
        const contrastCSS = `
/* EPUB Accessibility: Enhanced Color Contrast */
.epub-contrast-fix {
    color: #333333 !important;
    background-color: #ffffff !important;
}

/* Ensure link contrast */
a.epub-contrast-fix {
    color: #0066cc !important;
}

a.epub-contrast-fix:visited {
    color: #663399 !important;
}

/* Ensure sufficient contrast for headings */
h1.epub-contrast-fix, h2.epub-contrast-fix, h3.epub-contrast-fix,
h4.epub-contrast-fix, h5.epub-contrast-fix, h6.epub-contrast-fix {
    color: #222222 !important;
}
`;

        // Add to head if exists, otherwise add to body
        const head = $('head');
        if (head.length > 0) {
            head.append(`<style type="text/css">${contrastCSS}</style>`);
        } else {
            $('body').prepend(`<style type="text/css">${contrastCSS}</style>`);
        }

        return true;
    }
}