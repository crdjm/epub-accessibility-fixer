import { ValidationIssue, FixResult, ProcessingContext, EpubContent } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';

type CheerioStatic = any;

export class ResourceReferenceFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'Resource Reference Fixer';
    }

    getHandledCodes(): string[] {
        return [
            // 'RSC-006',                    // Remote resource reference (not fully implemented)
            'RSC-007',                    // Resource not found
            'PKG-009',                    // Missing file in package
            'remote-resource',            // Generic remote resource issues
            'external-resource',          // External resource references
            'missing-resource',           // Missing local resources
        ];
    }

    canFix(issue: ValidationIssue): boolean {
        // For now, we're being conservative about what we claim we can fix
        // RSC-006 requires downloading remote resources which is not fully implemented
        const handledCodes = this.getHandledCodes();
        
        // Check if this is an RSC-006 issue, which we're not fully implementing yet
        if (issue.code === 'RSC-006') {
            this.logger.info('RSC-006 issues require downloading remote resources, which is not fully implemented');
            return false;
        }
        
        return handledCodes.some(code => issue.code.includes(code) || code.includes(issue.code));
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing resource reference issue: ${issue.message}`);

        try {
            const changedFiles: string[] = [];
            let totalFixed = 0;

            // Extract resource URL from the issue message
            const resourceUrl = this.extractResourceUrl(issue.message);

            if (!resourceUrl) {
                return this.createFixResult(
                    false,
                    'Could not extract resource URL from issue message'
                );
            }

            this.logger.info(`Found problematic resource: ${resourceUrl}`);

            // If issue specifies a file, fix only that file
            if (issue.location?.file) {
                const content = this.findContentByPath(context, issue.location.file);
                if (content) {
                    const fixed = await this.fixResourceReferencesInFile(content, context, resourceUrl);
                    if (fixed) {
                        changedFiles.push(content.path);
                        totalFixed++;
                    }
                }
            } else {
                // Fix all content files that might reference the resource
                const contentFiles = this.getAllContentFiles(context);

                for (const content of contentFiles) {
                    const fixed = await this.fixResourceReferencesInFile(content, context, resourceUrl);
                    if (fixed) {
                        changedFiles.push(content.path);
                        totalFixed++;
                    }
                }
            }

            if (totalFixed > 0) {
                return this.createFixResult(
                    true,
                    `Fixed resource references in ${totalFixed} files`,
                    changedFiles,
                    { resourceUrl, filesFixed: totalFixed }
                );
            } else {
                return this.createFixResult(
                    false,
                    `No references to resource "${resourceUrl}" found that could be fixed`
                );
            }

        } catch (error) {
            this.logger.error(`Resource reference fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix resource references: ${error}`);
        }
    }

    private extractResourceUrl(message: string): string | null {
        // Look for quoted URLs in the error message
        const urlMatch = message.match(/"([^"]+)"/);
        if (urlMatch) {
            return urlMatch[1];
        }

        // Look for unquoted URLs starting with http
        const httpMatch = message.match(/https?:\/\/[^\s]+/);
        if (httpMatch) {
            return httpMatch[0];
        }

        // Look for file references
        const fileMatch = message.match(/resource "([^"]+)"/);
        if (fileMatch) {
            return fileMatch[1];
        }

        return null;
    }

    private async fixResourceReferencesInFile(content: EpubContent, context: ProcessingContext, resourceUrl: string): Promise<boolean> {
        const $ = this.loadDocument(content);
        let fixesApplied = false;

        // Find and fix different types of resource references
        const fixMethods = [
            () => this.fixImageReferences($, resourceUrl),
            () => this.fixLinkReferences($, resourceUrl),
            () => this.fixStylesheetReferences($, resourceUrl),
            () => this.fixScriptReferences($, resourceUrl),
            () => this.fixGenericReferences($, resourceUrl)
        ];

        for (const fixMethod of fixMethods) {
            if (fixMethod()) {
                fixesApplied = true;
            }
        }

        if (fixesApplied) {
            this.saveDocument($, content);
            this.logger.info(`Fixed resource references in ${content.path}`);
        }

        return fixesApplied;
    }

    private fixImageReferences($: CheerioStatic, resourceUrl: string): boolean {
        let fixed = false;

        $('img').each((_, img) => {
            const $img = $(img);
            const src = $img.attr('src');

            if (src === resourceUrl || this.urlsMatch(src, resourceUrl)) {
                // Strategy 1: Remove the problematic image and replace with text
                const alt = $img.attr('alt') || 'Image';
                const replacement = `<span class="epub-missing-image" title="Missing image: ${resourceUrl}">[${alt}]</span>`;

                $img.replaceWith(replacement);
                fixed = true;
                this.logger.info(`Removed remote image reference: ${resourceUrl}`);
            }
        });

        return fixed;
    }

    private fixLinkReferences($: CheerioStatic, resourceUrl: string): boolean {
        let fixed = false;

        $('a').each((_, link) => {
            const $link = $(link);
            const href = $link.attr('href');

            if (href === resourceUrl || this.urlsMatch(href, resourceUrl)) {
                // Strategy: Remove href but keep the text content with a note
                const linkText = $link.text() || 'Link';
                $link.removeAttr('href');
                $link.addClass('epub-broken-link');
                $link.attr('title', `Broken link: ${resourceUrl}`);

                // Replace with span to indicate it's no longer functional
                const replacement = `<span class="epub-broken-link" title="Broken link: ${resourceUrl}">${linkText}</span>`;
                $link.replaceWith(replacement);

                fixed = true;
                this.logger.info(`Removed remote link reference: ${resourceUrl}`);
            }
        });

        return fixed;
    }

    private fixStylesheetReferences($: CheerioStatic, resourceUrl: string): boolean {
        let fixed = false;

        $('link[rel="stylesheet"]').each((_, link) => {
            const $link = $(link);
            const href = $link.attr('href');

            if (href === resourceUrl || this.urlsMatch(href, resourceUrl)) {
                // Remove the external stylesheet reference
                $link.remove();
                fixed = true;
                this.logger.info(`Removed remote stylesheet reference: ${resourceUrl}`);
            }
        });

        // Also check for @import statements in style tags
        $('style').each((_, style) => {
            const $style = $(style);
            let content = $style.html() || '';

            const importRegex = new RegExp(`@import\\s+(?:url\\()?['"]*${this.escapeRegex(resourceUrl)}['"]*\\)?[^;]*;?`, 'gi');
            if (importRegex.test(content)) {
                content = content.replace(importRegex, '/* Removed remote import */');
                $style.html(content);
                fixed = true;
                this.logger.info(`Removed remote @import reference: ${resourceUrl}`);
            }
        });

        return fixed;
    }

    private fixScriptReferences($: CheerioStatic, resourceUrl: string): boolean {
        let fixed = false;

        $('script').each((_, script) => {
            const $script = $(script);
            const src = $script.attr('src');

            if (src === resourceUrl || this.urlsMatch(src, resourceUrl)) {
                // Remove the external script reference
                $script.remove();
                fixed = true;
                this.logger.info(`Removed remote script reference: ${resourceUrl}`);
            }
        });

        return fixed;
    }

    private fixGenericReferences($: CheerioStatic, resourceUrl: string): boolean {
        let fixed = false;

        // Check for any other attributes that might reference the resource
        const attributesToCheck = ['src', 'href', 'data', 'content', 'value'];

        for (const attr of attributesToCheck) {
            $(`[${attr}]`).each((_, element) => {
                const $element = $(element);
                const attrValue = $element.attr(attr);

                if (attrValue === resourceUrl || this.urlsMatch(attrValue, resourceUrl)) {
                    // Remove the problematic attribute
                    $element.removeAttr(attr);
                    $element.addClass('epub-fixed-reference');
                    $element.attr('data-original-' + attr, attrValue);

                    fixed = true;
                    this.logger.info(`Removed remote reference from ${attr} attribute: ${resourceUrl}`);
                }
            });
        }

        return fixed;
    }

    private urlsMatch(url1: string | undefined, url2: string): boolean {
        if (!url1) return false;

        // Direct match
        if (url1 === url2) return true;

        // Handle fragment identifiers
        const cleanUrl1 = url1.split('#')[0];
        const cleanUrl2 = url2.split('#')[0];

        return cleanUrl1 === cleanUrl2;
    }

    private escapeRegex(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}