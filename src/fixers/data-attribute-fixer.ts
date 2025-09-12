import { ValidationIssue, FixResult, ProcessingContext, EpubContent, FixDetail } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';

type CheerioStatic = any;
type CheerioElement = any;

export class DataAttributeFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'Data Attribute Fixer';
    }

    getHandledCodes(): string[] {
        return [
            'HTM_061',
            'data-contentUrn',
            'custom data attribute'
        ];
    }

    canFix(issue: ValidationIssue): boolean {
        // Check handled codes
        const codesMatch = this.getHandledCodes().some(code =>
            issue.code.includes(code) ||
            code.includes(issue.code) ||
            issue.message.includes(code)
        );

        if (codesMatch) {
            this.logger.info(`DataAttributeFixer can fix issue with code match: ${issue.code}`);
            return true;
        }

        // Also check if the message contains the specific patterns we handle
        const messagePatterns = [
            'is not a valid custom data attribute',
            'data-contentUrn',
            'custom data attribute',
            'must have at least one character after the hyphen',
            'not contain ASCII uppercase letters'
        ];

        const matchesPattern = messagePatterns.some(pattern =>
            issue.message.toLowerCase().includes(pattern.toLowerCase())
        );

        if (matchesPattern) {
            this.logger.info(`DataAttributeFixer can fix issue with pattern match: ${issue.message.substring(0, 100)}...`);
            return true;
        }

        this.logger.info(`DataAttributeFixer cannot fix issue: ${issue.code} - ${issue.message.substring(0, 100)}...`);
        return false;
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing data attribute issue: ${issue.message}`);
        this.logger.info(`Issue location: ${issue.location?.file || 'global'}`);

        try {
            const changedFiles: string[] = [];
            let totalFixed = 0;

            // If issue specifies a file, fix only that file
            if (issue.location?.file) {
                this.logger.info(`Processing specific file: ${issue.location.file}`);
                const content = this.findContentByPath(context, issue.location.file);

                if (content) {
                    this.logger.info(`Found content for file: ${content.path}`);
                    const fixed = await this.fixDataAttributesInFile(content);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                        this.logger.info(`Fixed ${fixed} data attribute issues in ${content.path}`);
                    }
                } else {
                    this.logger.warn(`Could not find content for file: ${issue.location.file}`);
                    // Try to process all files as a fallback
                    const contentFiles = this.getAllContentFiles(context);
                    this.logger.info(`Found ${contentFiles.length} content files to check`);

                    for (const content of contentFiles) {
                        const fixed = await this.fixDataAttributesInFile(content);
                        if (fixed > 0) {
                            changedFiles.push(content.path);
                            totalFixed += fixed;
                            this.logger.info(`Fixed ${fixed} data attribute issues in ${content.path}`);
                        }
                    }
                }
            } else {
                // Fix all content files
                this.logger.info('Processing all content files for data attribute issues');
                const contentFiles = this.getAllContentFiles(context);
                this.logger.info(`Found ${contentFiles.length} content files to check`);

                for (const content of contentFiles) {
                    const fixed = await this.fixDataAttributesInFile(content);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                        this.logger.info(`Fixed ${fixed} data attribute issues in ${content.path}`);
                    }
                }
            }

            if (totalFixed > 0) {
                return this.createFixResult(
                    true,
                    `Fixed ${totalFixed} invalid data attributes by converting to valid format`,
                    changedFiles,
                    { attributesFixed: totalFixed }
                );
            } else {
                return this.createFixResult(
                    false,
                    'No data attribute issues found to fix'
                );
            }

        } catch (error) {
            this.logger.error(`Data attribute fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix data attributes: ${error}`);
        }
    }

    private async fixDataAttributesInFile(content: EpubContent): Promise<number> {
        this.logger.info(`Fixing data attributes in file: ${content.path}`);
        
        const $ = this.loadDocument(content);
        let fixedCount = 0;
        const fixDetails: FixDetail[] = [];

        // Find all elements with data attributes
        $('*').each((_: number, element: CheerioElement) => {
            const $element = $(element);
            const attributes = element.attribs || {};
            
            // Check each attribute for invalid data attributes
            for (const [attrName, attrValue] of Object.entries(attributes)) {
                if (attrName.startsWith('data-')) {
                    // Check if this is an invalid data attribute
                    if (!this.isValidDataAttribute(attrName)) {
                        this.logger.info(`Found invalid data attribute: ${attrName}="${attrValue}" in ${content.path}`);
                        
                        // Convert to valid format
                        const validName = this.convertToValidDataAttribute(attrName);
                        if (validName && validName !== attrName) {
                            const originalHtml = $.html($element);
                            
                            // Remove the invalid attribute
                            $element.removeAttr(attrName);
                            // Add the valid attribute with the same value
                            $element.attr(validName, attrValue as string);
                            
                            fixedCount++;
                            
                            const fixedHtml = $.html($element);
                            fixDetails.push({
                                filePath: content.path,
                                originalContent: originalHtml,
                                fixedContent: fixedHtml,
                                explanation: `Converted invalid data attribute "${attrName}" to valid format "${validName}"`,
                                element: element.tagName || 'element',
                                attribute: attrName,
                                oldValue: attrName,
                                newValue: validName
                            });
                            
                            this.logger.info(`Converted invalid data attribute "${attrName}" to "${validName}" in ${content.path}`);
                        }
                    }
                }
            }
        });

        if (fixedCount > 0) {
            this.logger.info(`Saving document with ${fixedCount} fixed data attributes`);
            this.saveDocument($, content);
        }

        return fixedCount;
    }

    /**
     * Check if a data attribute name is valid according to HTML5 specification
     * Valid data attributes must:
     * - Start with "data-"
     * - Have at least one character after the hyphen
     * - Be XML-compatible
     * - Not contain ASCII uppercase letters
     */
    private isValidDataAttribute(attrName: string): boolean {
        // Must start with "data-"
        if (!attrName.startsWith('data-')) {
            return false;
        }
        
        // Must have at least one character after "data-"
        if (attrName.length <= 5) { // "data-" is 5 characters
            return false;
        }
        
        // Get the part after "data-"
        const dataPart = attrName.substring(5);
        
        // Must have at least one character
        if (dataPart.length === 0) {
            return false;
        }
        
        // Must not contain uppercase letters
        if (/[A-Z]/.test(dataPart)) {
            return false;
        }
        
        // Must be XML-compatible (valid characters)
        // XML names must start with a letter or underscore, and can contain letters, digits, hyphens, underscores, and periods
        // But data attributes can be more flexible, just need to be valid
        if (!/^[a-z][a-z0-9_-]*$/.test(dataPart)) {
            return false;
        }
        
        return true;
    }

    /**
     * Convert an invalid data attribute name to a valid one
     */
    private convertToValidDataAttribute(attrName: string): string | null {
        // Must start with "data-"
        if (!attrName.startsWith('data-')) {
            return null;
        }
        
        // Get the part after "data-"
        let dataPart = attrName.substring(5);
        
        // If empty, we can't fix it
        if (dataPart.length === 0) {
            return null;
        }
        
        // Convert to lowercase
        dataPart = dataPart.toLowerCase();
        
        // Replace invalid characters with hyphens
        dataPart = dataPart.replace(/[^a-z0-9_-]/g, '-');
        
        // Remove leading/trailing hyphens
        dataPart = dataPart.replace(/^-+|-+$/g, '');
        
        // Replace multiple consecutive hyphens with single hyphen
        dataPart = dataPart.replace(/-+/g, '-');
        
        // If we end up with an empty string or just hyphens, use a default name
        if (dataPart.length === 0 || /^-+$/.test(dataPart)) {
            dataPart = 'custom';
        }
        
        return `data-${dataPart}`;
    }
}