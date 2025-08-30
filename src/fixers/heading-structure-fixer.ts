import { ValidationIssue, FixResult, ProcessingContext, EpubContent } from '../types';
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
        return ['heading-structure', 'heading-order', 'page-has-heading-one', 'ACC-003'];
    }

    canFix(issue: ValidationIssue): boolean {
        return this.getHandledCodes().some(code => issue.code.includes(code));
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing heading structure: ${issue.message}`);

        try {
            const changedFiles: string[] = [];
            let totalFixed = 0;

            // If issue specifies a file, fix only that file
            if (issue.location?.file) {
                const content = this.findContentByPath(context, issue.location.file);
                if (content) {
                    const fixed = await this.fixHeadingStructureInFile(content);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                    }
                }
            } else {
                // Fix all content files
                const contentFiles = this.getAllContentFiles(context);

                for (const content of contentFiles) {
                    const fixed = await this.fixHeadingStructureInFile(content);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                    }
                }
            }

            if (totalFixed > 0) {
                return this.createFixResult(
                    true,
                    `Fixed heading structure in ${changedFiles.length} files (${totalFixed} changes)`,
                    changedFiles,
                    { changesApplied: totalFixed }
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

    private async fixHeadingStructureInFile(content: EpubContent): Promise<number> {
        const $ = this.loadDocument(content);
        let fixedCount = 0;

        // Analyze current heading structure
        const headings: Array<{ element: CheerioElement; level: number; text: string }> = [];

        $('h1, h2, h3, h4, h5, h6').each((_, headingElement) => {
            const level = parseInt(headingElement.tagName.charAt(1));
            const text = $(headingElement).text().trim();
            headings.push({ element: headingElement, level, text });
        });

        if (headings.length === 0) {
            return 0;
        }

        // Check if first heading should be h1
        const hasH1 = headings.some(h => h.level === 1);
        if (!hasH1 && headings.length > 0) {
            // Promote the first heading to h1
            const firstHeading = headings[0];
            if (firstHeading.level > 1) {
                $(firstHeading.element).replaceWith($(`<h1>${firstHeading.text}</h1>`));
                fixedCount++;
                this.logger.info(`Promoted first heading to h1: "${firstHeading.text}"`);
            }
        }

        // Fix heading level gaps
        for (let i = 1; i < headings.length; i++) {
            const current = headings[i];
            const previous = headings[i - 1];

            // If current heading level is more than 1 level deeper than previous
            if (current.level > previous.level + 1) {
                const newLevel = previous.level + 1;
                const $current = $(current.element);
                const newTag = `h${newLevel}`;

                $current.replaceWith($(`<${newTag}>${current.text}</${newTag}>`));
                fixedCount++;

                this.logger.info(`Adjusted heading level from h${current.level} to h${newLevel}: "${current.text}"`);
            }
        }

        // Ensure proper nesting within sections
        this.fixHeadingNesting($, headings);

        if (fixedCount > 0) {
            this.saveDocument($, content);
        }

        return fixedCount;
    }

    private fixHeadingNesting($: CheerioStatic, headings: Array<{ element: CheerioElement; level: number; text: string }>): void {
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
                    $section.prepend($(`<h${level}>${headingText}</h${level}>`));
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
                $parent.replaceWith($(`<h${level}>${text}</h${level}>`));
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