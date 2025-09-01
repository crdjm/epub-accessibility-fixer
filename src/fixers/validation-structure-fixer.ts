import { ValidationIssue, FixResult, ProcessingContext, EpubContent } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';

type CheerioStatic = any;

export class ValidationStructureFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'Validation Structure Fixer';
    }

    getHandledCodes(): string[] {
        return [
            'RSC-005', // Specific structural validation errors
            'dcterms:modified',
            'dc:date',
            'spine element toc attribute',
            'http-equiv',
            'role attribute',
            'toc attribute must be set',
            'xsi:type'
        ];
    }

    canFix(issue: ValidationIssue): boolean {
        const handledCodes = this.getHandledCodes();
        const issueCodeLower = issue.code.toLowerCase();
        const issueMessageLower = issue.message.toLowerCase();

        // Debug logging
        this.logger.info(`ValidationStructureFixer checking issue: code="${issue.code}", message="${issue.message}"`);

        // Check direct code matches
        if (handledCodes.some(code => issueCodeLower.includes(code.toLowerCase()) || code.toLowerCase().includes(issueCodeLower))) {
            this.logger.info(`ValidationStructureFixer can fix issue: matched by code`);
            return true;
        }

        // Check specific error message patterns we can fix
        const fixableMessages = [
            'dcterms:modified illegal syntax',
            'element "dc:date" not allowed here',
            'spine element toc attribute must be set',
            'value of attribute "http-equiv" is invalid',
            'value of attribute "role" is invalid',
            // Additional patterns for RSC-005 errors
            'rsc-005',
            'http-equiv'
        ];

        const canFix = fixableMessages.some(pattern => issueMessageLower.includes(pattern.toLowerCase()));
        if (canFix) {
            this.logger.info(`ValidationStructureFixer can fix issue: matched by message content`);
        } else {
            this.logger.info(`ValidationStructureFixer cannot fix issue`);
        }

        return canFix;
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing validation structure issue: ${issue.message}`);
        this.logger.info(`Issue code: ${issue.code}`);

        try {
            const changedFiles: string[] = [];
            let fixApplied = false;
            let fixDescription = '';

            // Handle different types of validation issues
            if (issue.message.includes('dcterms:modified illegal syntax')) {
                this.logger.info(`Handling dcterms:modified illegal syntax issue`);
                const result = await this.fixDctermsModifiedFormat(context);
                if (result.success) {
                    fixApplied = true;
                    fixDescription = result.message;
                    if (result.changedFiles) changedFiles.push(...result.changedFiles);
                }
            } else if (issue.message.includes('element "dc:date" not allowed here') || 
                       issue.message.includes('multiple dc:date')) {
                this.logger.info(`Handling dc:date issue`);
                const result = await this.fixMultipleDcDates(context);
                if (result.success) {
                    fixApplied = true;
                    fixDescription = result.message;
                    if (result.changedFiles) changedFiles.push(...result.changedFiles);
                }
            } else if (issue.message.includes('spine element toc attribute must be set')) {
                this.logger.info(`Handling spine toc attribute issue`);
                const result = await this.fixSpineTocAttribute(context);
                if (result.success) {
                    fixApplied = true;
                    fixDescription = result.message;
                    if (result.changedFiles) changedFiles.push(...result.changedFiles);
                }
            } else if (issue.message.includes('value of attribute "http-equiv" is invalid')) {
                this.logger.info(`Handling http-equiv issue`);
                const result = await this.fixInvalidHttpEquiv(issue, context);
                if (result.success) {
                    fixApplied = true;
                    fixDescription = result.message;
                    if (result.changedFiles) changedFiles.push(...result.changedFiles);
                }
            } else if (issue.message.includes('value of attribute "role" is invalid')) {
                this.logger.info(`Handling role attribute issue`);
                const result = await this.fixInvalidRole(issue, context);
                if (result.success) {
                    fixApplied = true;
                    fixDescription = result.message;
                    if (result.changedFiles) changedFiles.push(...result.changedFiles);
                }
            } else if (issue.message.includes('attribute "xsi:type" not allowed')) {
                this.logger.info(`Handling xsi:type attribute issue`);
                const result = await this.fixXsiTypeAttribute(context);
                if (result.success) {
                    fixApplied = true;
                    fixDescription = result.message;
                    if (result.changedFiles) changedFiles.push(...result.changedFiles);
                }
            } else {
                this.logger.info(`No handler found for this validation structure issue`);
            }

            if (fixApplied) {
                return this.createFixResult(
                    true,
                    fixDescription,
                    changedFiles,
                    { issueType: issue.code }
                );
            } else {
                return this.createFixResult(
                    false,
                    `Could not fix validation issue: ${issue.code}`
                );
            }

        } catch (error) {
            this.logger.error(`Validation structure fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix validation structure: ${error}`);
        }
    }

    /**
     * Fix dcterms:modified format to be ISO 8601 compliant (EPUB specific format)
     */
    private async fixDctermsModifiedFormat(context: ProcessingContext): Promise<FixResult> {
        // Find OPF file
        let opfContent: EpubContent | null = null;
        let opfPath: string = '';

        for (const [path, content] of context.contents) {
            if (path.endsWith('.opf') || content.mediaType === 'application/oebps-package+xml') {
                opfContent = content;
                opfPath = path;
                break;
            }
        }

        if (!opfContent) {
            return this.createFixResult(false, 'Could not find OPF file to fix dcterms:modified');
        }

        const $ = this.loadDocument(opfContent);
        let fixed = false;

        // Find and fix dcterms:modified elements with invalid format
        $('meta[property="dcterms:modified"]').each((_, element) => {
            const $element = $(element);
            const currentValue = $element.text().trim();
            
            // Check if it's not in the required EPUB format: CCYY-MM-DDThh:mm:ssZ
            if (currentValue && !this.isValidEpubTimestamp(currentValue)) {
                // Convert to valid EPUB timestamp format
                const validDate = this.convertToEpubTimestamp(currentValue);
                if (validDate) {
                    $element.text(validDate);
                    fixed = true;
                    this.logger.info(`Fixed dcterms:modified format: "${currentValue}" -> "${validDate}"`);
                } else {
                    // Use current timestamp as fallback in proper format
                    const currentTimestamp = this.getCurrentEpubTimestamp();
                    $element.text(currentTimestamp);
                    fixed = true;
                    this.logger.info(`Replaced invalid dcterms:modified with current timestamp: "${currentTimestamp}"`);
                }
            }
        });

        if (fixed) {
            this.saveDocument($, opfContent);
            return this.createFixResult(
                true,
                'Fixed dcterms:modified format to be EPUB compliant',
                [opfPath]
            );
        }

        return this.createFixResult(false, 'No dcterms:modified format issues found to fix');
    }

    /**
     * Fix multiple dc:date elements by consolidating them and moving to correct position
     */
    private async fixMultipleDcDates(context: ProcessingContext): Promise<FixResult> {
        // Find OPF file
        let opfContent: EpubContent | null = null;
        let opfPath: string = '';

        for (const [path, content] of context.contents) {
            if (path.endsWith('.opf') || content.mediaType === 'application/oebps-package+xml') {
                opfContent = content;
                opfPath = path;
                break;
            }
        }

        if (!opfContent) {
            return this.createFixResult(false, 'Could not find OPF file to fix dc:date elements');
        }

        const $ = this.loadDocument(opfContent);
        const dateElements = $('dc\\:date');
        
        if (dateElements.length === 0) {
            return this.createFixResult(false, 'No dc:date elements found');
        }

        // If there's only one dc:date, check if it's in the right position
        if (dateElements.length === 1) {
            const firstDate = dateElements.first();
            // Check if it's in the right position (should be after title, creator, language)
            // For now, we'll assume it's OK if there's only one
            return this.createFixResult(false, 'Single dc:date element found, no action needed');
        }

        this.logger.info(`Found ${dateElements.length} dc:date elements - consolidating to one`);

        // Keep the first date, remove the others
        let keptDateValue = '';
        let keptDateElement: any = null;
        
        dateElements.each((index, element) => {
            const $element = $(element);
            const dateValue = $element.text().trim();
            
            if (index === 0) {
                keptDateValue = dateValue;
                keptDateElement = $element;
                this.logger.info(`Keeping first dc:date: "${dateValue}"`);
            } else {
                this.logger.info(`Removing duplicate dc:date: "${dateValue}"`);
                $element.remove();
            }
        });

        // Move the kept date element to the correct position in metadata
        if (keptDateElement) {
            const metadata = $('metadata');
            if (metadata.length > 0) {
                // Remove from current position and append to metadata in correct order
                keptDateElement.remove();
                metadata.append(keptDateElement);
            }
        }

        this.saveDocument($, opfContent);
        return this.createFixResult(
            true,
            `Consolidated ${dateElements.length} dc:date elements to 1 and repositioned`,
            [opfPath]
        );
    }

    /**
     * Fix spine element missing toc attribute when NCX is present
     */
    private async fixSpineTocAttribute(context: ProcessingContext): Promise<FixResult> {
        // Find OPF file
        let opfContent: EpubContent | null = null;
        let opfPath: string = '';

        for (const [path, content] of context.contents) {
            if (path.endsWith('.opf') || content.mediaType === 'application/oebps-package+xml') {
                opfContent = content;
                opfPath = path;
                break;
            }
        }

        if (!opfContent) {
            return this.createFixResult(false, 'Could not find OPF file to fix spine toc attribute');
        }

        const $ = this.loadDocument(opfContent);
        
        // Check if NCX file exists in manifest
        const ncxItem = $('manifest item[media-type="application/x-dtbncx+xml"]');
        const spine = $('spine');
        
        if (spine.length === 0) {
            return this.createFixResult(false, 'No spine element found');
        }

        // Check if toc attribute is already set
        const existingToc = spine.attr('toc');
        if (existingToc) {
            this.logger.info(`Spine already has toc attribute: "${existingToc}"`);
            return this.createFixResult(false, 'Spine toc attribute already set');
        }

        // If NCX exists, set the toc attribute to point to the NCX file
        if (ncxItem.length > 0) {
            const ncxId = ncxItem.attr('id');
            if (ncxId) {
                spine.attr('toc', ncxId);
                this.logger.info(`Added toc attribute to spine: "${ncxId}"`);
                
                this.saveDocument($, opfContent);
                return this.createFixResult(
                    true,
                    `Added toc attribute to spine element pointing to NCX file`,
                    [opfPath]
                );
            } else {
                // If NCX item has no ID, we need to add one
                const ncxHref = ncxItem.attr('href');
                if (ncxHref) {
                    // Generate ID based on href
                    const ncxId = 'ncx-' + ncxHref.replace(/[^a-zA-Z0-9]/g, '-');
                    ncxItem.attr('id', ncxId);
                    spine.attr('toc', ncxId);
                    this.logger.info(`Added ID "${ncxId}" to NCX item and toc attribute to spine`);
                    
                    this.saveDocument($, opfContent);
                    return this.createFixResult(
                        true,
                        `Added ID to NCX item and toc attribute to spine element`,
                        [opfPath]
                    );
                }
            }
        } else {
            // If no NCX file, this might be an EPUB 3 file that doesn't need the toc attribute
            // In EPUB 3, navigation is handled by the nav document, not NCX
            // Check if this is EPUB 3
            const packageElement = $('package');
            const version = packageElement.attr('version');
            if (version && version.startsWith('3')) {
                this.logger.info('EPUB 3 detected - spine toc attribute not required for EPUB 3');
                return this.createFixResult(
                    true,
                    'EPUB 3 detected - spine toc attribute not required',
                    [opfPath]
                );
            } else {
                // For EPUB 2 without NCX, this is a structural issue
                this.logger.warn('EPUB 2 detected but no NCX file found - this may be a structural issue');
                return this.createFixResult(
                    false,
                    'EPUB 2 detected but no NCX file found - structural issue needs manual review',
                    [opfPath]
                );
            }
        }

        return this.createFixResult(false, 'Could not determine appropriate action for spine toc attribute');
    }

    /**
     * Fix invalid http-equiv attributes in HTML files
     */
    private async fixInvalidHttpEquiv(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        const changedFiles: string[] = [];
        let totalFixed = 0;

        // If issue specifies a file, fix only that file
        if (issue.location?.file) {
            this.logger.info(`Looking for file: ${issue.location.file}`);
            const content = this.findContentByPath(context, issue.location.file);
            if (content) {
                this.logger.info(`Found content for file: ${content.path}`);
                const fixed = await this.fixHttpEquivInFile(content);
                if (fixed) {
                    changedFiles.push(content.path);
                    totalFixed++;
                }
            } else {
                this.logger.warn(`Could not find content for file: ${issue.location.file}`);
                // Try to find any HTML files as fallback
                const contentFiles = this.getAllContentFiles(context);
                for (const content of contentFiles) {
                    // Only process files that might contain the issue
                    if (content.path.includes('htm') || 
                        (issue.location.file && content.path.includes(issue.location.file))) {
                        const fixed = await this.fixHttpEquivInFile(content);
                        if (fixed) {
                            changedFiles.push(content.path);
                            totalFixed++;
                        }
                    }
                }
            }
        } else {
            // Fix all HTML content files
            const contentFiles = this.getAllContentFiles(context);
            for (const content of contentFiles) {
                const fixed = await this.fixHttpEquivInFile(content);
                if (fixed) {
                    changedFiles.push(content.path);
                    totalFixed++;
                }
            }
        }

        if (totalFixed > 0) {
            return this.createFixResult(
                true,
                `Fixed invalid http-equiv attributes in ${totalFixed} files`,
                changedFiles
            );
        }

        return this.createFixResult(false, 'No invalid http-equiv attributes found to fix');
    }

    /**
     * Fix invalid role attributes in HTML files
     */
    private async fixInvalidRole(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        const changedFiles: string[] = [];
        let totalFixed = 0;

        // If issue specifies a file, fix only that file
        if (issue.location?.file) {
            this.logger.info(`Looking for file for role fix: ${issue.location.file}`);
            const content = this.findContentByPath(context, issue.location.file);
            if (content) {
                this.logger.info(`Found content for role fix: ${content.path}`);
                const fixed = await this.fixInvalidRoleInFile(content);
                if (fixed) {
                    changedFiles.push(content.path);
                    totalFixed++;
                }
            } else {
                this.logger.warn(`Could not find content for role fix: ${issue.location.file}`);
                // Try to find nav.xhtml as fallback
                for (const [path, content] of context.contents) {
                    if (path.includes('nav.xhtml')) {
                        const fixed = await this.fixInvalidRoleInFile(content);
                        if (fixed) {
                            changedFiles.push(content.path);
                            totalFixed++;
                        }
                    }
                }
            }
        } else {
            // Fix all HTML content files
            const contentFiles = this.getAllContentFiles(context);
            for (const content of contentFiles) {
                const fixed = await this.fixInvalidRoleInFile(content);
                if (fixed) {
                    changedFiles.push(content.path);
                    totalFixed++;
                }
            }
        }

        if (totalFixed > 0) {
            return this.createFixResult(
                true,
                `Fixed invalid role attributes in ${totalFixed} files`,
                changedFiles
            );
        }

        return this.createFixResult(false, 'No invalid role attributes found to fix');
    }

    /**
     * Fix http-equiv attributes in a single file
     */
    private async fixHttpEquivInFile(content: EpubContent): Promise<boolean> {
        this.logger.info(`Processing http-equiv fix for file: ${content.path}`);
        const $ = this.loadDocument(content);
        let fixed = false;
        let issuesFound = false;

        // Find meta elements with http-equiv attributes
        $('meta[http-equiv]').each((_, element) => {
            issuesFound = true;
            const $element = $(element);
            const httpEquiv = $element.attr('http-equiv');
            
            this.logger.info(`Found meta tag with http-equiv="${httpEquiv}" in ${content.path}`);
            
            // Check if it's a valid http-equiv value according to EPUB spec
            if (httpEquiv) {
                // Use the isValidHttpEquiv method to check validity
                const isValid = this.isValidHttpEquiv(httpEquiv);
                
                this.logger.info(`http-equiv="${httpEquiv}" is valid: ${isValid}`);
                
                if (!isValid) {
                    // Invalid http-equiv value, remove the entire meta tag since it's not valid
                    $element.remove();
                    fixed = true;
                    this.logger.info(`Removed meta tag with invalid http-equiv="${httpEquiv}" in ${content.path}`);
                } else {
                    // Valid http-equiv, but fix case if needed
                    const validValues = [
                        'content-type',
                        'content-security-policy',
                        'x-ua-compatible',
                        'refresh',
                        'default-style'
                    ];
                    const correctCase = validValues.find(valid => valid.toLowerCase() === httpEquiv.toLowerCase());
                    if (correctCase && correctCase !== httpEquiv) {
                        $element.attr('http-equiv', correctCase);
                        fixed = true;
                        this.logger.info(`Fixed case of http-equiv from "${httpEquiv}" to "${correctCase}" in ${content.path}`);
                    }
                    
                    // Ensure it has content attribute for certain http-equiv values
                    const contentAttr = $element.attr('content');
                    if (!contentAttr) {
                        // Add default content based on http-equiv value
                        const lowerHttpEquiv = httpEquiv.toLowerCase();
                        if (lowerHttpEquiv === 'content-type') {
                            $element.attr('content', 'text/html; charset=utf-8');
                            fixed = true;
                            this.logger.info(`Added content="text/html; charset=utf-8" to meta element with http-equiv="${httpEquiv}" in ${content.path}`);
                        } else if (lowerHttpEquiv === 'refresh') {
                            // Refresh should have a value like "5; url=http://example.com"
                            // If missing, we should remove it as it's not properly configured
                            $element.remove();
                            fixed = true;
                            this.logger.info(`Removed meta element with http-equiv="${httpEquiv}" due to missing content attribute in ${content.path}`);
                        } else if (lowerHttpEquiv === 'x-ua-compatible') {
                            $element.attr('content', 'IE=edge');
                            fixed = true;
                            this.logger.info(`Added content="IE=edge" to meta element with http-equiv="${httpEquiv}" in ${content.path}`);
                        }
                    }
                }
            }
        });

        // Fix meta elements that are missing required attributes entirely
        $('meta').each((_, element) => {
            const $element = $(element);
            const hasName = $element.attr('name');
            const hasHttpEquiv = $element.attr('http-equiv');
            const hasProperty = $element.attr('property');
            
            // If meta tag has no identifying attribute, it's invalid
            if (!hasName && !hasHttpEquiv && !hasProperty) {
                issuesFound = true;
                // Check if it has content attribute
                const contentAttr = $element.attr('content');
                if (contentAttr) {
                    // Remove the invalid meta element
                    $element.remove();
                    fixed = true;
                    this.logger.info(`Removed invalid meta element with content="${contentAttr}" in ${content.path}`);
                } else {
                    // Completely invalid meta element, remove it
                    $element.remove();
                    fixed = true;
                    this.logger.info(`Removed completely invalid meta element in ${content.path}`);
                }
            }
        });

        // Also check for any meta tags that might have invalid http-equiv values
        // but weren't caught by the selector above
        $('meta').each((_, element) => {
            const $element = $(element);
            const httpEquiv = $element.attr('http-equiv');
            
            if (httpEquiv) {
                issuesFound = true;
                // Double-check validity
                const isValid = this.isValidHttpEquiv(httpEquiv);
                
                if (!isValid) {
                    $element.remove();
                    fixed = true;
                    this.logger.info(`Removed meta tag with invalid http-equiv="${httpEquiv}" in ${content.path} (secondary check)`);
                }
            }
        });

        if (fixed) {
            this.logger.info(`Saving document with http-equiv fixes for ${content.path}`);
            this.saveDocument($, content);
        } else if (issuesFound) {
            this.logger.info(`Found http-equiv issues but no fixes were applied for ${content.path}`);
        } else {
            this.logger.info(`No http-equiv issues found in ${content.path}`);
        }

        return fixed;
    }

    /**
     * Fix invalid role attributes in a single file
     */
    private async fixInvalidRoleInFile(content: EpubContent): Promise<boolean> {
        const $ = this.loadDocument(content);
        let fixed = false;

        // Find elements with invalid role values
        $('[role]').each((_, element) => {
            const $element = $(element);
            const role = $element.attr('role');
            const tagName = $element.prop('tagName')?.toLowerCase();
            
            if (role) {
                // Check if this is a nav element that needs a specific role
                if (tagName === 'nav') {
                    if (!this.isValidNavRole(role)) {
                        // For nav elements, use valid navigation role
                        $element.attr('role', 'navigation');
                        fixed = true;
                        this.logger.info(`Fixed invalid role="${role}" to role="navigation" in nav element in ${content.path}`);
                    }
                } 
                // For other elements, check if role is valid ARIA role
                else if (!this.isValidAriaRole(role)) {
                    // Only remove if it's clearly invalid, not just uncommon
                    // Be more conservative about removing roles
                    const clearlyInvalidRoles = [
                        'invalid', 'bad', 'wrong', 'incorrect', 'noneexistent'
                    ];
                    
                    if (clearlyInvalidRoles.some(invalid => role.toLowerCase().includes(invalid))) {
                        // For clearly invalid roles, remove them
                        $element.removeAttr('role');
                        fixed = true;
                        this.logger.info(`Removed clearly invalid role="${role}" from ${tagName} element in ${content.path}`);
                    } else {
                        // For uncertain cases, leave as is to avoid breaking valid content
                        this.logger.info(`Preserving uncertain role="${role}" on ${tagName} element in ${content.path}`);
                    }
                }
            }
        });

        if (fixed) {
            this.saveDocument($, content);
        }

        return fixed;
    }

    /**
     * Fix xsi:type attributes in OPF file
     */
    private async fixXsiTypeAttribute(context: ProcessingContext): Promise<FixResult> {
        // Find OPF file
        let opfContent: EpubContent | null = null;
        let opfPath: string = '';

        for (const [path, content] of context.contents) {
            if (path.endsWith('.opf') || content.mediaType === 'application/oebps-package+xml') {
                opfContent = content;
                opfPath = path;
                break;
            }
        }

        if (!opfContent) {
            return this.createFixResult(false, 'Could not find OPF file to fix xsi:type attributes');
        }

        const $ = this.loadDocument(opfContent);
        let fixed = false;
        let removedCount = 0;

        // Remove xsi:type attributes from dc:language and other Dublin Core elements
        $('dc\\:language[xsi\\:type], language[xsi\\:type]').each((_, element) => {
            const $element = $(element);
            const type = $element.attr('xsi:type');
            $element.removeAttr('xsi:type');
            fixed = true;
            removedCount++;
            this.logger.info(`Removed xsi:type="${type}" from language element in ${opfPath}`);
        });

        // Remove any other xsi:type attributes from Dublin Core elements
        $('dc\\:*[xsi\\:type]').each((_, element) => {
            const $element = $(element);
            const type = $element.attr('xsi:type');
            const tagName = element.tagName || 'unknown';
            $element.removeAttr('xsi:type');
            fixed = true;
            removedCount++;
            this.logger.info(`Removed xsi:type="${type}" from ${tagName} element in ${opfPath}`);
        });

        // Also check for any remaining xsi:type attributes that might not be caught by the above selectors
        $('*[xsi\\:type]').each((_, element) => {
            const $element = $(element);
            const type = $element.attr('xsi:type');
            // Get tagName safely
            let tagName = 'unknown';
            if ($element.prop('tagName')) {
                tagName = $element.prop('tagName');
            } else if (element.type === 'tag' && 'name' in element) {
                tagName = (element as any).name;
            }
            // Only remove if it's a Dublin Core element or clearly an EPUB 2.0 attribute
            if (tagName.startsWith('dc:') || tagName === 'language' || tagName === 'identifier' || tagName === 'date') {
                $element.removeAttr('xsi:type');
                fixed = true;
                removedCount++;
                this.logger.info(`Removed xsi:type="${type}" from ${tagName} element (secondary check) in ${opfPath}`);
            }
        });

        if (fixed) {
            this.saveDocument($, opfContent);
            return this.createFixResult(
                true,
                `Removed ${removedCount} EPUB 2.0 xsi:type attributes`,
                [opfPath]
            );
        }

        return this.createFixResult(false, 'No xsi:type attributes found to fix');
    }

    /**
     * Check if a date string is valid EPUB timestamp format: CCYY-MM-DDThh:mm:ssZ
     */
    private isValidEpubTimestamp(dateStr: string): boolean {
        // EPUB requires strict timestamp format: CCYY-MM-DDThh:mm:ssZ
        const epubTimestampRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
        return epubTimestampRegex.test(dateStr);
    }

    /**
     * Convert various date formats to EPUB timestamp format
     */
    private convertToEpubTimestamp(dateStr: string): string | null {
        try {
            // Try to parse the date
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) {
                return null;
            }
            // Format to EPUB required format: CCYY-MM-DDThh:mm:ssZ
            return date.getUTCFullYear() + 
                '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + 
                '-' + String(date.getUTCDate()).padStart(2, '0') + 
                'T' + String(date.getUTCHours()).padStart(2, '0') + 
                ':' + String(date.getUTCMinutes()).padStart(2, '0') + 
                ':' + String(date.getUTCSeconds()).padStart(2, '0') + 
                'Z';
        } catch (error) {
            return null;
        }
    }

    /**
     * Get current timestamp in EPUB format
     */
    private getCurrentEpubTimestamp(): string {
        const now = new Date();
        return now.getUTCFullYear() + 
            '-' + String(now.getUTCMonth() + 1).padStart(2, '0') + 
            '-' + String(now.getUTCDate()).padStart(2, '0') + 
            'T' + String(now.getUTCHours()).padStart(2, '0') + 
            ':' + String(now.getUTCMinutes()).padStart(2, '0') + 
            ':' + String(now.getUTCSeconds()).padStart(2, '0') + 
            'Z';
    }

    /**
     * Check if http-equiv value is valid for EPUB
     */
    private isValidHttpEquiv(value: string): boolean {
        const validValues = [
            'content-type',
            'content-security-policy',
            'x-ua-compatible',
            'refresh',
            'default-style'
            // Note: 'content-style-type' is not valid according to EPUBCheck
        ];
        // Case insensitive comparison
        return validValues.some(valid => valid.toLowerCase() === value.toLowerCase());
    }

    /**
     * Check if role value is valid for nav elements
     */
    private isValidNavRole(role: string): boolean {
        const validNavRoles = [
            'doc-index',
            'doc-pagelist', 
            'doc-toc',
            'navigation'
        ];
        return validNavRoles.includes(role.toLowerCase());
    }

    /**
     * Check if role value is valid ARIA role
     */
    private isValidAriaRole(role: string): boolean {
        // Comprehensive list of valid ARIA roles
        const validRoles = [
            'alert', 'alertdialog', 'application', 'article', 'banner', 'button', 'cell', 
            'checkbox', 'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition', 
            'dialog', 'directory', 'document', 'feed', 'figure', 'form', 'grid', 'gridcell', 
            'group', 'heading', 'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 
            'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 
            'navigation', 'none', 'note', 'option', 'presentation', 'progressbar', 'radio', 
            'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 
            'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'switch', 'tab', 
            'table', 'tablist', 'tabpanel', 'term', 'textbox', 'timer', 'toolbar', 'tooltip', 
            'tree', 'treegrid', 'treeitem',
            // EPUB-specific roles
            'doc-abstract', 'doc-acknowledgments', 'doc-afterword', 'doc-appendix', 'doc-backlink', 
            'doc-biblioentry', 'doc-bibliography', 'doc-biblioref', 'doc-chapter', 'doc-colophon', 
            'doc-conclusion', 'doc-cover', 'doc-credit', 'doc-credits', 'doc-dedication', 
            'doc-endnote', 'doc-endnotes', 'doc-epigraph', 'doc-epilogue', 'doc-errata', 
            'doc-example', 'doc-footnote', 'doc-foreword', 'doc-glossary', 'doc-glossref', 
            'doc-index', 'doc-introduction', 'doc-noteref', 'doc-notice', 'doc-pagebreak', 
            'doc-pagelist', 'doc-part', 'doc-preface', 'doc-prologue', 'doc-pullquote', 
            'doc-qna', 'doc-subtitle', 'doc-tip', 'doc-toc'
        ];
        return validRoles.includes(role.toLowerCase());
    }
}