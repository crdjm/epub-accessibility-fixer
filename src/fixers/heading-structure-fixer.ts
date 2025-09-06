import { ValidationIssue, FixResult, ProcessingContext, EpubContent, FixDetail } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';

type CheerioStatic = any;
type CheerioElement = any;
type Cheerio = any;

export class HeadingStructureFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'Heading Structure Fixer';
    }

    getHandledCodes(): string[] {
        return ['heading-structure', 'heading-order', 'page-has-heading-one', 'ACC-003', 'empty-heading'];
    }

    canFix(issue: ValidationIssue): boolean {
        const handledCodes = this.getHandledCodes();
        const codesMatch = handledCodes.some(code => 
            issue.code.includes(code) || 
            code.includes(issue.code) ||
            issue.message.includes(code)
        );
        
        if (codesMatch) {
            this.logger.info(`HeadingStructureFixer can fix issue with code match: ${issue.code}`);
            return true;
        }
        
        // Also check if the message contains the specific text patterns we handle
        const messagePatterns = [
            'Element does not have text that is visible to screen readers',
            'aria-label attribute does not exist or is empty',
            'aria-labelledby attribute does not exist',
            'Element has no title attribute'
        ];
        
        // Only handle these patterns if the issue is actually related to headings
        const isHeadingIssue = issue.message.includes('heading') ||
                              issue.code.includes('heading') ||
                              (issue as any).element?.match(/^h[1-6]$/) ||
                              issue.location?.file?.includes('heading');
        
        const matchesPattern = messagePatterns.some(pattern => issue.message.includes(pattern));
        
        if (isHeadingIssue && matchesPattern) {
            this.logger.info(`HeadingStructureFixer can fix heading issue with pattern match: ${issue.message.substring(0, 100)}...`);
            return true;
        }
        
        this.logger.info(`HeadingStructureFixer cannot fix issue: ${issue.code} - ${issue.message.substring(0, 100)}...`);
        return false;
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing heading structure: ${issue.message}`);

        try {
            const changedFiles: string[] = [];
            let totalFixed = 0;
            const fixDetails: FixDetail[] = [];

            // If issue specifies a file, fix only that file
            if (issue.location?.file) {
                const content = this.findContentByPath(context, issue.location.file);
                if (content) {
                    const { fixed, details } = await this.fixHeadingStructureInFile(content);
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
                    const { fixed, details } = await this.fixHeadingStructureInFile(content);
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
                    `Fixed heading structure in ${changedFiles.length} files (${totalFixed} changes)`,
                    changedFiles,
                    { changesApplied: totalFixed, fixDetails }
                );
            } else {
                return this.createFixResult(
                    false,
                    'No heading structure issues found to fix'
                );
            }

        } catch (error) {
            this.logger.error(`Heading structure fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix heading structure: ${error}`);
        }
    }

    private async fixHeadingStructureInFile(content: EpubContent): Promise<{ fixed: number; details: FixDetail[] }> {
        const $ = this.loadDocument(content);
        let fixedCount = 0;
        const fixDetails: FixDetail[] = [];

        // Analyze current heading structure
        const headings: Array<{ element: CheerioElement; level: number; text: string }> = [];

        $('h1, h2, h3, h4, h5, h6').each((_, headingElement) => {
            const level = parseInt(headingElement.tagName.charAt(1));
            const text = $(headingElement).text().trim();
            headings.push({ element: headingElement, level, text });
        });

        if (headings.length === 0) {
            return { fixed: 0, details: fixDetails };
        }

        // Fix empty headings
        for (const heading of headings) {
            if (!heading.text) {
                const $heading = $(heading.element);
                const originalHtml = $.html($heading);
                const fixed = this.fixEmptyHeading($heading, $, content.path);
                if (fixed) {
                    fixedCount++;
                    const fixedHtml = $.html($heading);
                    fixDetails.push({
                        filePath: content.path,
                        originalContent: originalHtml,
                        fixedContent: fixedHtml,
                        explanation: `Fixed empty heading: Added text or aria-label to empty ${heading.element.tagName}`,
                        element: heading.element.tagName.toLowerCase(),
                        attribute: undefined,
                        oldValue: undefined,
                        newValue: $heading.text() || $heading.attr('aria-label'),
                        issueCode: 'heading-order',  // Add issue code
                        selector: `${heading.element.tagName}:contains('${heading.text}')`  // Add selector
                    });
                }
            }
        }

        // Check if first heading should be h1
        const hasH1 = headings.some(h => h.level === 1);
        if (!hasH1 && headings.length > 0) {
            // Promote the first heading to h1
            const firstHeading = headings[0];
            if (firstHeading.level > 1 && firstHeading.text) { // Only promote if it has text
                const $firstHeading = $(firstHeading.element);
                const originalHtml = $.html($firstHeading);
                $firstHeading.replaceWith($(`<h1>${firstHeading.text}</h1>`));
                fixedCount++;
                const fixedHtml = $.html($(`<h1>${firstHeading.text}</h1>`));
                fixDetails.push({
                    filePath: content.path,
                    originalContent: originalHtml,
                    fixedContent: fixedHtml,
                    explanation: `Promoted first heading to h1: "${firstHeading.text}"`,
                    element: 'h1',
                    attribute: undefined,
                    oldValue: undefined,
                    newValue: firstHeading.text,
                    issueCode: 'heading-order',  // Add issue code
                    selector: `h1:contains('${firstHeading.text}')`  // Add selector
                });
                this.logger.info(`Promoted first heading to h1: "${firstHeading.text}"`);
            }
        }

        // Fix heading level gaps
        for (let i = 1; i < headings.length; i++) {
            const current = headings[i];
            const previous = headings[i - 1];

            // If current heading level is more than 1 level deeper than previous
            if (current.level > previous.level + 1 && current.text) { // Only fix if it has text
                const newLevel = previous.level + 1;
                const $current = $(current.element);
                const originalHtml = $.html($current);
                const newTag = `h${newLevel}`;

                $current.replaceWith($(`<${newTag}>${current.text}</${newTag}>`));
                fixedCount++;
                const fixedHtml = $.html($(`<${newTag}>${current.text}</${newTag}>`));

                fixDetails.push({
                    filePath: content.path,
                    originalContent: originalHtml,
                    fixedContent: fixedHtml,
                    explanation: `Adjusted heading level from h${current.level} to h${newLevel}: "${current.text}"`,
                    element: newTag,
                    attribute: undefined,
                    oldValue: undefined,
                    newValue: current.text,
                    issueCode: 'heading-order',  // Add issue code
                    selector: `${newTag}:contains('${current.text}')`  // Add selector
                });

                this.logger.info(`Adjusted heading level from h${current.level} to h${newLevel}: "${current.text}"`);
            }
        }

        // Ensure proper nesting within sections
        this.fixHeadingNesting($, headings, content.path, fixDetails);

        if (fixedCount > 0) {
            this.saveDocument($, content);
        }

        return { fixed: fixedCount, details: fixDetails };
    }

    private fixEmptyHeading($heading: Cheerio, $: CheerioStatic, filePath: string): boolean {
        const tagName = $heading.prop('tagName')?.toLowerCase();
        const className = $heading.attr('class') || '';
        const id = $heading.attr('id') || '';
        
        this.logger.info(`Found empty heading: ${tagName} with class="${className}" id="${id}" in ${filePath}`);

        // Strategy 1: Try to generate meaningful text from context
        const generatedText = this.generateHeadingTextFromContext($heading, $, className, id);
        if (generatedText) {
            $heading.text(generatedText);
            this.logger.info(`Added generated text to empty heading: "${generatedText}"`);
            return true;
        }

        // Strategy 2: Add aria-label if we can generate meaningful text
        const ariaLabelText = this.generateAriaLabelText(className, id);
        if (ariaLabelText) {
            $heading.attr('aria-label', ariaLabelText);
            $heading.attr('role', 'heading');
            $heading.attr('aria-level', tagName?.charAt(1) || '1');
            this.logger.info(`Added aria-label to empty heading: "${ariaLabelText}"`);
            return true;
        }

        // Strategy 3: Remove the empty heading if it serves no purpose
        // Only remove if it doesn't have important attributes
        const hasImportantAttributes = $heading.attr('id') || $heading.attr('epub:type') || $heading.attr('role');
        if (!hasImportantAttributes) {
            $heading.remove();
            this.logger.info(`Removed empty heading with no purpose`);
            return true;
        }

        // Strategy 4: If it has important attributes, hide it from screen readers but keep it in the DOM
        // Only apply this fix if it doesn't already have aria-hidden
        if (!$heading.attr('aria-hidden')) {
            $heading.attr('aria-hidden', 'true');
            this.logger.info(`Hid empty heading from screen readers but kept in DOM`);
            return true;
        }

        // No fix could be applied
        this.logger.info(`Could not apply any fix to empty heading`);
        return false;
    }

    private generateHeadingTextFromContext($heading: Cheerio, $: CheerioStatic, className: string, id: string): string | null {
        // Try to generate text based on class or id
        if (className) {
            // Clean up class name to make it readable
            const cleaned = className
                .replace(/[-_]/g, ' ')
                .replace(/\b(h\d|heading|title|chapter|section|part)\b/gi, '')
                .trim()
                .replace(/\s+/g, ' ');

            if (cleaned && cleaned.length > 0) {
                // Capitalize first letter
                return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
            }
        }

        if (id) {
            // Clean up id to make it readable
            const cleaned = id
                .replace(/[-_]/g, ' ')
                .replace(/\b(h\d|heading|title|chapter|section|part)\b/gi, '')
                .trim()
                .replace(/\s+/g, ' ');

            if (cleaned && cleaned.length > 0) {
                // Capitalize first letter
                return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
            }
        }

        // Look for nearby text content that might be related
        const parent = $heading.parent();
        if (parent.length > 0) {
            // Check siblings for text
            const siblings = parent.contents().filter((_, node) => node.nodeType === 3); // Text nodes
            for (let i = 0; i < siblings.length; i++) {
                const text = $(siblings[i]).text().trim();
                if (text && text.length > 0 && text.length < 50) {
                    return text;
                }
            }
        }

        return null;
    }

    private generateAriaLabelText(className: string, id: string): string | null {
        // Generate aria-label text from class or id
        if (className) {
            // Clean up class name to make it readable
            const cleaned = className
                .replace(/[-_]/g, ' ')
                .replace(/\b(h\d|heading|title|chapter|section|part)\b/gi, '')
                .trim()
                .replace(/\s+/g, ' ');

            if (cleaned && cleaned.length > 0) {
                // Capitalize first letter
                return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
            }
        }

        if (id) {
            // Clean up id to make it readable
            const cleaned = id
                .replace(/[-_]/g, ' ')
                .replace(/\b(h\d|heading|title|chapter|section|part)\b/gi, '')
                .trim()
                .replace(/\s+/g, ' ');

            if (cleaned && cleaned.length > 0) {
                // Capitalize first letter
                return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
            }
        }

        return null;
    }

    private fixHeadingNesting($: CheerioStatic, headings: Array<{ element: CheerioElement; level: number; text: string }>, filePath: string, fixDetails: FixDetail[]): void {
        // Look for content that should have headings based on structure

        // Check for chapters or sections without proper headings
        $('section, chapter, div.chapter, div.section').each((_, sectionElement) => {
            const $section = $(sectionElement);
            const existingHeading = $section.children('h1, h2, h3, h4, h5, h6').first();

            if (existingHeading.length === 0) {
                // Try to determine heading text from class, id, or content
                const headingText = this.generateHeadingText($section);
                if (headingText) {
                    // Determine appropriate heading level based on nesting
                    const level = this.determineHeadingLevel($section, $);
                    const originalHtml = $.html($section);
                    $section.prepend($(`<h${level}>${headingText}</h${level}>`));
                    const fixedHtml = $.html($section);
                    fixDetails.push({
                        filePath: filePath,
                        originalContent: originalHtml,
                        fixedContent: fixedHtml,
                        explanation: `Added missing heading: "${headingText}" (h${level})`,
                        element: `h${level}`,
                        attribute: undefined,
                        oldValue: undefined,
                        newValue: headingText,
                        issueCode: 'heading-order',  // Add issue code
                        selector: `h${level}:contains('${headingText}')`  // Add selector
                    });
                    this.logger.info(`Added missing heading: "${headingText}" (h${level})`);
                }
            }
        });

        // Look for emphasized text that should be headings
        $('p strong, p b, p em').each((_, element) => {
            const $element = $(element);
            const $parent = $element.parent();
            const text = $element.text().trim();

            // Check if this might be a heading
            if (this.looksLikeHeading(text, $parent)) {
                const level = this.determineHeadingLevel($parent, $);
                const originalHtml = $.html($parent);
                $parent.replaceWith($(`<h${level}>${text}</h${level}>`));
                const fixedHtml = $.html($parent);
                fixDetails.push({
                    filePath: filePath,
                    originalContent: originalHtml,
                    fixedContent: fixedHtml,
                    explanation: `Converted emphasized text to heading: "${text}" (h${level})`,
                    element: `h${level}`,
                    attribute: undefined,
                    oldValue: undefined,
                    newValue: text,
                    issueCode: 'heading-order',  // Add issue code
                    selector: `h${level}:contains('${text}')`  // Add selector
                });
                this.logger.info(`Converted emphasized text to heading: "${text}" (h${level})`);
            }
        });
    }

    private generateHeadingText($section: Cheerio): string | null {
        // Try to get heading text from various sources
        const className = $section.attr('class') || '';
        const id = $section.attr('id') || '';

        // Check for title attribute
        const title = $section.attr('title');
        if (title) {
            return title;
        }

        // Check for data attributes
        const dataTitle = $section.attr('data-title') || $section.attr('data-heading');
        if (dataTitle) {
            return dataTitle;
        }

        // Generate from class name
        if (className) {
            const cleaned = className
                .replace(/[-_]/g, ' ')
                .replace(/\b(chapter|section|part)\b/gi, '')
                .trim();

            if (cleaned && cleaned.length > 0) {
                return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
            }
        }

        // Generate from ID
        if (id) {
            const cleaned = id
                .replace(/[-_]/g, ' ')
                .replace(/\b(chapter|section|part)\b/gi, '')
                .trim();

            if (cleaned && cleaned.length > 0) {
                return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
            }
        }

        // Look for first text content that might be a title
        const firstText = $section.contents().filter((index, node) => {
            return node.nodeType === 3; // Text node
        }).first().text().trim();

        if (firstText && firstText.length > 0 && firstText.length < 100) {
            return firstText;
        }

        return null;
    }

    private determineHeadingLevel($element: Cheerio, $: CheerioStatic): number {
        // Find the nearest parent heading
        let current = $element.parent();
        let parentLevel = 0;

        while (current.length > 0 && current[0].tagName !== 'body') {
            const headings = current.children('h1, h2, h3, h4, h5, h6');
            if (headings.length > 0) {
                const firstHeading = headings.first();
                parentLevel = parseInt(firstHeading[0].tagName.charAt(1));
                break;
            }
            current = current.parent();
        }

        // Check nesting depth
        let nestingLevel = 0;
        let ancestor = $element.parent();
        while (ancestor.length > 0 && ancestor[0].tagName !== 'body') {
            if (ancestor.is('section, chapter, div.chapter, div.section, article')) {
                nestingLevel++;
            }
            ancestor = ancestor.parent();
        }

        // Calculate appropriate level
        let level = Math.max(parentLevel + 1, nestingLevel + 1);
        level = Math.min(level, 6); // Max h6
        level = Math.max(level, 1); // Min h1

        return level;
    }

    private looksLikeHeading(text: string, $parent: Cheerio): boolean {
        // Criteria for text that looks like a heading
        const trimmed = text.trim();

        // Length check
        if (trimmed.length < 3 || trimmed.length > 100) {
            return false;
        }

        // Check if parent only contains this text (or mostly this text)
        const parentText = $parent.text().trim();
        if (parentText === trimmed || parentText.length - trimmed.length < 10) {
            return true;
        }

        // Check for heading-like patterns
        const headingPatterns = [
            /^(chapter|section|part)\s+\d+/i,
            /^\d+\.\s/,
            /^[A-Z][A-Z\s]+$/,  // ALL CAPS
            /^[A-Z][a-z\s]+:$/   // Title Case with colon
        ];

        return headingPatterns.some(pattern => pattern.test(trimmed));
    }
}