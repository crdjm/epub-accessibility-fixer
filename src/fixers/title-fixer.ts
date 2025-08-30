import { ValidationIssue, FixResult, ProcessingContext, EpubContent } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';

type CheerioStatic = any;

export class TitleFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'Title Fixer';
    }

    getHandledCodes(): string[] {
        return [
            'RSC-017', // Missing title element
            'document-title' // Document missing title
        ];
    }

    canFix(issue: ValidationIssue): boolean {
        return this.getHandledCodes().some(code => issue.code.includes(code) || code.includes(issue.code));
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing title issue: ${issue.message}`);

        try {
            const changedFiles: string[] = [];
            let totalFixed = 0;

            // If issue specifies a file, fix only that file
            if (issue.location?.file) {
                const content = this.findContentByPath(context, issue.location.file);
                if (content) {
                    const fixed = await this.fixTitleInFile(content, context);
                    if (fixed) {
                        changedFiles.push(content.path);
                        totalFixed++;
                    }
                }
            } else {
                // Fix all content files that need titles
                const contentFiles = this.getAllContentFiles(context);

                for (const content of contentFiles) {
                    const fixed = await this.fixTitleInFile(content, context);
                    if (fixed) {
                        changedFiles.push(content.path);
                        totalFixed++;
                    }
                }
            }

            if (totalFixed > 0) {
                return this.createFixResult(
                    true,
                    `Added title elements to ${totalFixed} documents`,
                    changedFiles,
                    { documentsFixed: totalFixed }
                );
            } else {
                return this.createFixResult(
                    false,
                    'No missing titles found to fix'
                );
            }

        } catch (error) {
            this.logger.error(`Title fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix titles: ${error}`);
        }
    }

    private async fixTitleInFile(content: EpubContent, context: ProcessingContext): Promise<boolean> {
        const $ = this.loadDocument(content);
        const head = $('head');

        if (head.length === 0) {
            return false; // No head element to work with
        }

        const existingTitle = head.find('title');

        // Check if title is missing or empty
        if (existingTitle.length === 0 || !existingTitle.text().trim()) {
            const title = this.generateTitleForDocument($, content, context);

            if (existingTitle.length > 0) {
                // Update existing empty title
                existingTitle.text(title);
                this.logger.info(`Updated title in ${content.path}: "${title}"`);
            } else {
                // Add new title element
                head.prepend(`<title>${title}</title>`);
                this.logger.info(`Added title to ${content.path}: "${title}"`);
            }

            this.saveDocument($, content);
            return true;
        }

        return false; // Title already exists and is not empty
    }

    private generateTitleForDocument($: CheerioStatic, content: EpubContent, context: ProcessingContext): string {
        // Try to extract a meaningful title from the document

        // 1. Look for the first heading
        const firstHeading = $('h1, h2, h3, h4, h5, h6').first();
        if (firstHeading.length > 0) {
            const headingText = firstHeading.text().trim();
            if (headingText) {
                return headingText;
            }
        }

        // 2. Look for epub:type="chapter" or similar
        const chapterElement = $('[epub\\:type*="chapter"], [epub\\:type*="part"]').first();
        if (chapterElement.length > 0) {
            const text = chapterElement.text().trim();
            if (text && text.length < 100) { // Reasonable title length
                return text;
            }
        }

        // 3. Use filename as basis
        const filename = content.path.split('/').pop() || 'Document';
        const baseName = filename.replace(/\.[^.]+$/, ''); // Remove extension

        // Convert common patterns to readable titles
        const titleFromFilename = baseName
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, (l) => l.toUpperCase())
            .replace(/\b(Chapter|Ch|Part|Section)\s*(\d+)/i, (match, type, num) => {
                return `${type} ${num}`;
            });

        // 4. Fallback to book title + filename
        const bookTitle = context.metadata.title || 'EPUB Document';

        if (titleFromFilename !== baseName) {
            return titleFromFilename;
        } else {
            return `${bookTitle} - ${titleFromFilename}`;
        }
    }
}