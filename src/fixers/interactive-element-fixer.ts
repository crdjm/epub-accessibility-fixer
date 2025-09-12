import { ValidationIssue, FixResult, ProcessingContext, EpubContent, AccessibilityIssue } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';

type CheerioStatic = any;

export class InteractiveElementFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'Interactive Element Accessibility Fixer';
    }

    getHandledCodes(): string[] {
        return [
            'aria-label',                   // Missing or empty aria-label
            'aria-labelledby',             // Invalid aria-labelledby references
            'accessible-name',             // Missing accessible name
            'label',                       // General labeling issues
            'button-name',                 // Buttons without accessible names
            'input-label',                 // Form inputs without labels
            'form-field-multiple-labels',  // Multiple labels for form fields
            'missing-title',               // Missing title attributes
            'screen-reader-text',          // Text not visible to screen readers
            // Remove the specific DAISY ACE messages that might conflict with other fixers
        ];
    }

    canFix(issue: ValidationIssue): boolean {
        // Check handled codes
        const codesMatch = this.getHandledCodes().some(code =>
            issue.code.includes(code) ||
            code.includes(issue.code) ||
            issue.message.includes(code)
        );

        // Avoid handling link-specific issues that are handled by LinkAccessibilityFixer
        const isLinkIssue = issue.message.includes('link') || 
                           (issue as any).element === 'a' ||
                           (issue.location?.file && issue.location.file.includes('link')) ||
                           issue.code === 'link-name' || // DAISY ACE uses link-name for link issues
                           issue.message.includes('Element is in tab order and does not have accessible text'); // This is also a link issue
        
        // Avoid handling image-specific issues that are handled by AltTextFixer
        const isImageIssue = issue.code === 'image-alt' ||  // Direct check for image-alt code
                            issue.message.includes('Element does not have an alt attribute') ||
                            issue.message.includes('Image missing alt attribute') ||
                            (issue as any).element === 'img' ||
                            (issue.location?.file && issue.location.file.includes('img')) ||
                            // Also check for the general "text not visible" message when it's about images
                            (issue.message.includes('Element does not have text that is visible to screen readers') && 
                             ((issue as any).element === 'img' || 
                              (issue.location?.file && issue.location.file.includes('img'))));
        
        // Avoid handling landmark-specific issues that are handled by LandmarkUniqueFixer
        const isLandmarkIssue = issue.code.includes('landmark') ||
                               issue.message.includes('landmark') ||
                               issue.message.includes('The landmark must have a unique');

        if (codesMatch) {
            // If this is an image issue, link issue, or landmark issue, don't handle it even if the code matches
            if (isImageIssue || isLinkIssue || isLandmarkIssue) {
                this.logger.info(`InteractiveElementFixer refusing to handle issue with code match: ${issue.code} (image: ${isImageIssue}, link: ${isLinkIssue}, landmark: ${isLandmarkIssue})`);
                return false;
            }
            
            this.logger.info(`InteractiveElementFixer can fix issue with code match: ${issue.code}`);
            return true;
        }

        // Also check if the message contains the specific text patterns we handle
        const messagePatterns = [
            'Element does not have text that is visible to screen readers',
            'aria-label attribute does not exist or is empty',
            'aria-labelledby attribute does not exist',
            'Element has no title attribute'
        ];

        this.logger.info(`InteractiveElementFixer checking issue: code="${issue.code}", message="${issue.message.substring(0, 100)}...", isLinkIssue=${isLinkIssue}, isImageIssue=${isImageIssue}, isLandmarkIssue=${isLandmarkIssue}`);

        // Only handle non-link, non-image, non-landmark issues with these message patterns
        if (!isLinkIssue && !isImageIssue && !isLandmarkIssue && messagePatterns.some(pattern => issue.message.includes(pattern))) {
            this.logger.info(`InteractiveElementFixer can fix non-link, non-image, non-landmark issue with pattern match: ${issue.message.substring(0, 100)}...`);
            return true;
        }

        this.logger.info(`InteractiveElementFixer cannot fix issue: ${issue.code} - ${issue.message.substring(0, 100)}...`);
        return false;
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing interactive element accessibility issue: ${issue.message}`);

        try {
            const changedFiles: string[] = [];
            let totalFixed = 0;

            // If issue specifies a file, fix only that file
            if (issue.location?.file) {
                const content = this.findContentByPath(context, issue.location.file);
                if (content) {
                    const fixed = await this.fixInteractiveElementsInFile(content, context, issue);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                    }
                }
            } else {
                // Fix all content files that might have interactive element issues
                const contentFiles = this.getAllContentFiles(context);

                for (const content of contentFiles) {
                    const fixed = await this.fixInteractiveElementsInFile(content, context, issue);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                    }
                }
            }

            if (totalFixed > 0) {
                return this.createFixResult(
                    true,
                    `Fixed interactive element accessibility issues for ${totalFixed} elements`,
                    changedFiles,
                    { elementsFixed: totalFixed }
                );
            } else {
                return this.createFixResult(
                    false,
                    'No interactive element accessibility issues found that could be automatically fixed'
                );
            }

        } catch (error) {
            this.logger.error(`Interactive element accessibility fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix interactive element accessibility: ${error}`);
        }
    }

    private async fixInteractiveElementsInFile(content: EpubContent, context: ProcessingContext, issue: ValidationIssue): Promise<number> {
        const $ = this.loadDocument(content);
        let fixedCount = 0;

        // Define interactive elements that need accessible names
        const interactiveSelectors = [
            'button',
            'input[type="button"]',
            'input[type="submit"]',
            'input[type="reset"]',
            'input[type="image"]',
            'input[type="text"]',
            'input[type="email"]',
            'input[type="password"]',
            'input[type="search"]',
            'input[type="url"]',
            'input[type="tel"]',
            'input[type="number"]',
            'input[type="date"]',
            'input[type="time"]',
            'input[type="datetime-local"]',
            'input[type="month"]',
            'input[type="week"]',
            'input[type="color"]',
            'input[type="range"]',
            'input[type="file"]',
            'input[type="checkbox"]',
            'input[type="radio"]',
            'textarea',
            'select',
            'a[href]',
            '[role="button"]',
            '[role="link"]',
            '[role="menuitem"]',
            '[role="tab"]',
            '[tabindex]'
        ];

        for (const selector of interactiveSelectors) {
            $(selector).each((_, element) => {
                const $element = $(element);
                if (this.fixElementAccessibility($element, $)) {
                    fixedCount++;
                }
            });
        }

        if (fixedCount > 0) {
            this.saveDocument($, content);
            this.logger.info(`Fixed accessibility issues for ${fixedCount} interactive elements in ${content.path}`);
        }

        return fixedCount;
    }

    private fixElementAccessibility($element: any, $: CheerioStatic): boolean {
        const tagName = $element.prop('tagName')?.toLowerCase();
        const type = $element.attr('type')?.toLowerCase();
        let fixed = false;

        // Check if element has accessible text
        if (!this.hasAccessibleName($element, $)) {
            const accessibleName = this.generateAccessibleName($element, tagName, type, $);
            if (accessibleName) {
                $element.attr('aria-label', accessibleName);
                fixed = true;
                this.logger.info(`Added aria-label "${accessibleName}" to ${tagName} element`);
            }
        }

        // Fix invalid aria-labelledby references
        const ariaLabelledBy = $element.attr('aria-labelledby');
        if (ariaLabelledBy && this.hasInvalidAriaLabelledBy($element, ariaLabelledBy, $)) {
            $element.removeAttr('aria-labelledby');
            const fallbackLabel = this.generateAccessibleName($element, tagName, type, $);
            if (fallbackLabel) {
                $element.attr('aria-label', fallbackLabel);
                fixed = true;
                this.logger.info(`Replaced invalid aria-labelledby with aria-label "${fallbackLabel}"`);
            }
        }

        // Add title attribute if helpful and missing
        if (this.shouldAddTitle($element, tagName, type) && !$element.attr('title')) {
            const title = this.generateTitleText($element, tagName, type);
            if (title) {
                $element.attr('title', title);
                fixed = true;
                this.logger.info(`Added title "${title}" to ${tagName} element`);
            }
        }

        return fixed;
    }

    private hasAccessibleName($element: any, $: CheerioStatic): boolean {
        // Check visible text content
        const visibleText = $element.text().trim();
        if (visibleText && visibleText.length > 0) {
            return true;
        }

        // Check aria-label
        const ariaLabel = $element.attr('aria-label');
        if (ariaLabel && ariaLabel.trim().length > 0) {
            return true;
        }

        // Check aria-labelledby
        const ariaLabelledBy = $element.attr('aria-labelledby');
        if (ariaLabelledBy && this.hasValidAriaLabelledBy($element, ariaLabelledBy, $)) {
            return true;
        }

        // Check for associated label (for form controls)
        const id = $element.attr('id');
        if (id) {
            const label = $(`label[for="${id}"]`);
            if (label.length > 0 && label.text().trim()) {
                return true;
            }
        }

        // Check if element is inside a label
        const parentLabel = $element.closest('label');
        if (parentLabel.length > 0 && parentLabel.text().trim()) {
            return true;
        }

        // Check value attribute for buttons
        const value = $element.attr('value');
        if (value && value.trim().length > 0) {
            return true;
        }

        // Check alt attribute for image inputs
        const alt = $element.attr('alt');
        if (alt && alt.trim().length > 0) {
            return true;
        }

        // Check placeholder (not ideal, but better than nothing)
        const placeholder = $element.attr('placeholder');
        if (placeholder && placeholder.trim().length > 0) {
            return true;
        }

        return false;
    }

    private hasValidAriaLabelledBy($element: any, ariaLabelledBy: string, $: CheerioStatic): boolean {
        const ids = ariaLabelledBy.split(/\s+/);

        for (const id of ids) {
            if (!id.trim()) continue;

            const referencedElement = $(`#${id.trim()}`);
            if (referencedElement.length > 0) {
                const referencedText = referencedElement.text().trim();
                if (referencedText && referencedText.length > 0) {
                    return true;
                }
            }
        }

        return false;
    }

    private hasInvalidAriaLabelledBy($element: any, ariaLabelledBy: string, $: CheerioStatic): boolean {
        return !this.hasValidAriaLabelledBy($element, ariaLabelledBy, $);
    }

    private generateAccessibleName($element: any, tagName: string, type?: string, $?: CheerioStatic): string {
        // Try different strategies based on element type

        // For form controls, look for nearby labels or context
        if (this.isFormControl(tagName, type)) {
            return this.generateFormControlName($element, tagName, type, $);
        }

        // For buttons
        if (tagName === 'button' || type === 'button' || type === 'submit' || type === 'reset') {
            return this.generateButtonName($element, type);
        }

        // For links
        if (tagName === 'a') {
            return this.generateLinkName($element);
        }

        // For generic interactive elements
        return this.generateGenericName($element, tagName);
    }

    private isFormControl(tagName: string, type?: string): boolean {
        const formControls = ['input', 'textarea', 'select'];
        return formControls.includes(tagName);
    }

    private generateFormControlName($element: any, tagName: string, type?: string, $?: CheerioStatic): string {
        // Look for nearby label text
        const nearbyLabel = this.findNearbyLabelText($element, $);
        if (nearbyLabel) {
            return nearbyLabel;
        }

        // Use placeholder if available (not ideal but better than nothing)
        const placeholder = $element.attr('placeholder');
        if (placeholder && placeholder.trim()) {
            return placeholder.trim();
        }

        // Generate based on type and context
        const typeLabels: { [key: string]: string } = {
            'text': 'Text input',
            'email': 'Email address',
            'password': 'Password',
            'search': 'Search field',
            'url': 'Website URL',
            'tel': 'Phone number',
            'number': 'Number input',
            'date': 'Date picker',
            'time': 'Time picker',
            'datetime-local': 'Date and time picker',
            'month': 'Month picker',
            'week': 'Week picker',
            'color': 'Color picker',
            'range': 'Range slider',
            'file': 'File upload',
            'checkbox': 'Checkbox',
            'radio': 'Radio button'
        };

        if (type && typeLabels[type]) {
            return typeLabels[type];
        }

        if (tagName === 'textarea') {
            return 'Text area';
        }

        if (tagName === 'select') {
            return 'Dropdown menu';
        }

        return 'Form field';
    }

    private findNearbyLabelText($element: any, $?: CheerioStatic): string {
        if (!$ || !$element) return '';

        // Look for preceding text in the same parent
        const parent = $element.parent();
        const elementIndex = parent.children().index($element);

        // Check previous siblings for label-like text
        for (let i = elementIndex - 1; i >= 0; i--) {
            const sibling = parent.children().eq(i);
            const text = sibling.text().trim();

            if (text && text.length > 0 && text.length < 100) {
                // Remove common form suffixes
                const cleanText = text.replace(/[:\*\s]+$/, '').trim();
                if (cleanText.length > 0) {
                    return cleanText;
                }
            }
        }

        // Look for nearby headings
        const nearbyHeading = $element.prevAll('h1, h2, h3, h4, h5, h6').first();
        if (nearbyHeading.length > 0) {
            const headingText = nearbyHeading.text().trim();
            if (headingText && headingText.length < 50) {
                return `${headingText} field`;
            }
        }

        return '';
    }

    private generateButtonName($element: any, type?: string): string {
        // Check button content
        const content = $element.text().trim();
        if (content) {
            return content;
        }

        // Check value attribute
        const value = $element.attr('value');
        if (value && value.trim()) {
            return value.trim();
        }

        // Generate based on type
        const typeLabels: { [key: string]: string } = {
            'submit': 'Submit form',
            'reset': 'Reset form',
            'button': 'Button',
            'image': 'Image button'
        };

        if (type && typeLabels[type]) {
            return typeLabels[type];
        }

        return 'Button';
    }

    private generateLinkName($element: any): string {
        const href = $element.attr('href') || '';
        const text = $element.text().trim();

        if (text && !this.isGenericText(text)) {
            return text;
        }

        // Check for images in link
        const images = $element.find('img');
        if (images.length > 0) {
            const alt = images.first().attr('alt');
            if (alt && alt.trim()) {
                return alt.trim();
            }
            return 'Image link';
        }

        // Generate from href
        if (href.startsWith('mailto:')) {
            return 'Email link';
        }

        if (href.startsWith('tel:')) {
            return 'Phone number link';
        }

        if (href.startsWith('http')) {
            return 'External link';
        }

        if (href.startsWith('#')) {
            return 'Internal navigation link';
        }

        return 'Link';
    }

    private generateGenericName($element: any, tagName: string): string {
        const role = $element.attr('role');

        if (role) {
            return `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
        }

        return `Interactive ${tagName}`;
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

    private shouldAddTitle($element: any, tagName: string, type?: string): boolean {
        // Add titles to form controls and buttons for additional context
        const elementsNeedingTitles = ['input', 'textarea', 'select', 'button'];
        return elementsNeedingTitles.includes(tagName);
    }

    private generateTitleText($element: any, tagName: string, type?: string): string {
        const ariaLabel = $element.attr('aria-label');
        if (ariaLabel && ariaLabel.trim()) {
            return `${ariaLabel.trim()} - additional context`;
        }

        const placeholder = $element.attr('placeholder');
        if (placeholder && placeholder.trim()) {
            return `Enter ${placeholder.toLowerCase()}`;
        }

        // Generate helpful title based on element type
        const titleMap: { [key: string]: string } = {
            'email': 'Enter a valid email address',
            'password': 'Enter your password',
            'search': 'Enter search terms',
            'url': 'Enter a valid website URL',
            'tel': 'Enter a phone number',
            'number': 'Enter a numeric value',
            'date': 'Select a date',
            'time': 'Select a time'
        };

        if (type && titleMap[type]) {
            return titleMap[type];
        }

        return '';
    }
}