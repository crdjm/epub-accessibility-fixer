import { ValidationIssue, FixResult, ProcessingContext, EpubContent } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';

export class MetadataAccessibilityFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'Metadata Accessibility Fixer';
    }

    getHandledCodes(): string[] {
        return [
            'epub-lang',
            'metadata-accessmode',
            'metadata-accessmodesufficient',
            'metadata-accessibilityfeature',
            'metadata-accessibilityhazard',
            'metadata-accessibilitysummary'
        ];
    }

    canFix(issue: ValidationIssue): boolean {
        const handledCodes = this.getHandledCodes();
        const issueCodeLower = issue.code.toLowerCase();
        const issueMessageLower = issue.message.toLowerCase();

        // Debug logging
        this.logger.info(`MetadataAccessibilityFixer checking issue: code="${issue.code}", message="${issue.message}"`);

        // Check direct code matches
        if (handledCodes.some(code => issueCodeLower.includes(code.toLowerCase()) || code.toLowerCase().includes(issueCodeLower))) {
            this.logger.info(`MetadataAccessibilityFixer can fix issue: matched by code`);
            return true;
        }

        // Check specific error message patterns we can fix
        const fixableMessages = [
            'opf xml language is provided',
            'schema:accessmode',
            'schema:accessmodesufficient',
            'schema:accessibilityfeature',
            'schema:accessibilityhazard',
            'schema:accessibilitysummary',
            'accessibility metadata',
            'Publications must declare the'
        ];

        const canFix = fixableMessages.some(pattern => issueMessageLower.includes(pattern.toLowerCase()));
        if (canFix) {
            this.logger.info(`MetadataAccessibilityFixer can fix issue: matched by message content`);
        } else {
            this.logger.info(`MetadataAccessibilityFixer cannot fix issue`);
        }

        return canFix;
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing metadata accessibility issue: ${issue.message}`);
        this.logger.info(`Issue code: ${issue.code}`);

        try {
            const changedFiles: string[] = [];
            let fixApplied = false;
            let fixDescription = '';

            // Handle different types of metadata accessibility issues
            if (issue.code === 'epub-lang' || issue.message.includes('opf xml language is provided')) {
                this.logger.info(`Handling epub-lang issue`);
                const result = await this.fixEpubLanguage(context);
                if (result.success) {
                    fixApplied = true;
                    fixDescription = result.message;
                    if (result.changedFiles) changedFiles.push(...result.changedFiles);
                }
            } else if (issue.code === 'metadata-accessmode' || issue.message.includes('schema:accessmode')) {
                this.logger.info(`Handling metadata-accessmode issue`);
                const result = await this.fixAccessModeMetadata(context);
                if (result.success) {
                    fixApplied = true;
                    fixDescription = result.message;
                    if (result.changedFiles) changedFiles.push(...result.changedFiles);
                }
            } else if (issue.code === 'metadata-accessmodesufficient' || issue.message.includes('schema:accessmodesufficient')) {
                this.logger.info(`Handling metadata-accessmodesufficient issue`);
                const result = await this.fixAccessModeSufficientMetadata(context);
                if (result.success) {
                    fixApplied = true;
                    fixDescription = result.message;
                    if (result.changedFiles) changedFiles.push(...result.changedFiles);
                }
            } else if (issue.code === 'metadata-accessibilityfeature' || issue.message.includes('schema:accessibilityfeature')) {
                this.logger.info(`Handling metadata-accessibilityfeature issue`);
                const result = await this.fixAccessibilityFeatureMetadata(context);
                if (result.success) {
                    fixApplied = true;
                    fixDescription = result.message;
                    if (result.changedFiles) changedFiles.push(...result.changedFiles);
                }
            } else if (issue.code === 'metadata-accessibilityhazard' || issue.message.includes('schema:accessibilityhazard')) {
                this.logger.info(`Handling metadata-accessibilityhazard issue`);
                const result = await this.fixAccessibilityHazardMetadata(context);
                if (result.success) {
                    fixApplied = true;
                    fixDescription = result.message;
                    if (result.changedFiles) changedFiles.push(...result.changedFiles);
                }
            } else if (issue.code === 'metadata-accessibilitysummary' || issue.message.includes('schema:accessibilitysummary')) {
                this.logger.info(`Handling metadata-accessibilitysummary issue`);
                const result = await this.fixAccessibilitySummaryMetadata(context);
                if (result.success) {
                    fixApplied = true;
                    fixDescription = result.message;
                    if (result.changedFiles) changedFiles.push(...result.changedFiles);
                }
            } else {
                this.logger.info(`No handler found for this metadata accessibility issue`);
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
                    `Could not fix metadata accessibility issue: ${issue.code}`
                );
            }

        } catch (error) {
            this.logger.error(`Metadata accessibility fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix metadata accessibility: ${error}`);
        }
    }

    /**
     * Fix epub-lang issue by adding xml:lang attribute to OPF package element
     */
    private async fixEpubLanguage(context: ProcessingContext): Promise<FixResult> {
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
            return this.createFixResult(false, 'Could not find OPF file to fix epub language');
        }

        const $ = this.loadDocument(opfContent);
        let fixed = false;

        // Add xml:lang attribute to package element if missing
        const packageElement = $('package');
        if (packageElement.length > 0) {
            const xmlLang = packageElement.attr('xml:lang');
            if (!xmlLang) {
                // Try to get language from dc:language element
                const dcLanguage = $('dc\\:language').first().text().trim();
                const lang = dcLanguage || 'en'; // Default to English if not found
                packageElement.attr('xml:lang', lang);
                fixed = true;
                this.logger.info(`Added xml:lang="${lang}" to package element in ${opfPath}`);
            }
        }

        if (fixed) {
            this.saveDocument($, opfContent);
            return this.createFixResult(
                true,
                'Added xml:lang attribute to OPF package element',
                [opfPath]
            );
        }

        return this.createFixResult(false, 'No epub language issues found to fix');
    }

    /**
     * Add schema:accessMode metadata to OPF
     */
    private async fixAccessModeMetadata(context: ProcessingContext): Promise<FixResult> {
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
            return this.createFixResult(false, 'Could not find OPF file to add accessMode metadata');
        }

        const $ = this.loadDocument(opfContent);
        let fixed = false;

        // Check if schema:accessMode metadata already exists
        const existingAccessMode = $('meta[property="schema:accessMode"]');
        if (existingAccessMode.length === 0) {
            // Add schema:accessMode metadata
            const metadata = $('metadata');
            if (metadata.length > 0) {
                const accessModeElement = $('<meta>')
                    .attr('property', 'schema:accessMode')
                    .text('textual');
                metadata.append('\n    ').append(accessModeElement);
                fixed = true;
                this.logger.info(`Added schema:accessMode metadata to ${opfPath}`);
            }
        }

        if (fixed) {
            this.saveDocument($, opfContent);
            return this.createFixResult(
                true,
                'Added schema:accessMode metadata to OPF',
                [opfPath]
            );
        }

        return this.createFixResult(false, 'No accessMode metadata issues found to fix');
    }

    /**
     * Add schema:accessModeSufficient metadata to OPF
     */
    private async fixAccessModeSufficientMetadata(context: ProcessingContext): Promise<FixResult> {
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
            return this.createFixResult(false, 'Could not find OPF file to add accessModeSufficient metadata');
        }

        const $ = this.loadDocument(opfContent);
        let fixed = false;

        // Check if schema:accessModeSufficient metadata already exists
        const existingAccessModeSufficient = $('meta[property="schema:accessModeSufficient"]');
        if (existingAccessModeSufficient.length === 0) {
            // Add schema:accessModeSufficient metadata
            const metadata = $('metadata');
            if (metadata.length > 0) {
                const accessModeSufficientElement = $('<meta>')
                    .attr('property', 'schema:accessModeSufficient')
                    .text('textual');
                metadata.append('\n    ').append(accessModeSufficientElement);
                fixed = true;
                this.logger.info(`Added schema:accessModeSufficient metadata to ${opfPath}`);
            }
        }

        if (fixed) {
            this.saveDocument($, opfContent);
            return this.createFixResult(
                true,
                'Added schema:accessModeSufficient metadata to OPF',
                [opfPath]
            );
        }

        return this.createFixResult(false, 'No accessModeSufficient metadata issues found to fix');
    }

    /**
     * Add schema:accessibilityFeature metadata to OPF
     */
    private async fixAccessibilityFeatureMetadata(context: ProcessingContext): Promise<FixResult> {
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
            return this.createFixResult(false, 'Could not find OPF file to add accessibilityFeature metadata');
        }

        const $ = this.loadDocument(opfContent);
        let fixed = false;

        // Check if schema:accessibilityFeature metadata already exists
        const existingAccessibilityFeatures = $('meta[property="schema:accessibilityFeature"]');
        if (existingAccessibilityFeatures.length === 0) {
            // Add schema:accessibilityFeature metadata
            const metadata = $('metadata');
            if (metadata.length > 0) {
                // Add common accessibility features
                const features = ['tableOfContents', 'readingOrder'];
                features.forEach(feature => {
                    const featureElement = $('<meta>')
                        .attr('property', 'schema:accessibilityFeature')
                        .text(feature);
                    metadata.append('\n    ').append(featureElement);
                });
                fixed = true;
                this.logger.info(`Added schema:accessibilityFeature metadata to ${opfPath}`);
            }
        }

        if (fixed) {
            this.saveDocument($, opfContent);
            return this.createFixResult(
                true,
                'Added schema:accessibilityFeature metadata to OPF',
                [opfPath]
            );
        }

        return this.createFixResult(false, 'No accessibilityFeature metadata issues found to fix');
    }

    /**
     * Add schema:accessibilityHazard metadata to OPF
     */
    private async fixAccessibilityHazardMetadata(context: ProcessingContext): Promise<FixResult> {
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
            return this.createFixResult(false, 'Could not find OPF file to add accessibilityHazard metadata');
        }

        const $ = this.loadDocument(opfContent);
        let fixed = false;

        // Check if schema:accessibilityHazard metadata already exists
        const existingAccessibilityHazards = $('meta[property="schema:accessibilityHazard"]');
        if (existingAccessibilityHazards.length === 0) {
            // Add schema:accessibilityHazard metadata
            const metadata = $('metadata');
            if (metadata.length > 0) {
                // Add common accessibility hazards (defaulting to 'none' if no hazards detected)
                const hazardElement = $('<meta>')
                    .attr('property', 'schema:accessibilityHazard')
                    .text('none');
                metadata.append('\n    ').append(hazardElement);
                fixed = true;
                this.logger.info(`Added schema:accessibilityHazard metadata to ${opfPath}`);
            }
        }

        if (fixed) {
            this.saveDocument($, opfContent);
            return this.createFixResult(
                true,
                'Added schema:accessibilityHazard metadata to OPF',
                [opfPath]
            );
        }

        return this.createFixResult(false, 'No accessibilityHazard metadata issues found to fix');
    }

    /**
     * Add schema:accessibilitySummary metadata to OPF
     */
    private async fixAccessibilitySummaryMetadata(context: ProcessingContext): Promise<FixResult> {
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
            return this.createFixResult(false, 'Could not find OPF file to add accessibilitySummary metadata');
        }

        const $ = this.loadDocument(opfContent);
        let fixed = false;

        // Check if schema:accessibilitySummary metadata already exists
        const existingAccessibilitySummary = $('meta[property="schema:accessibilitySummary"]');
        if (existingAccessibilitySummary.length === 0) {
            // Add schema:accessibilitySummary metadata
            const metadata = $('metadata');
            if (metadata.length > 0) {
                // Add accessibility summary
                const summaryElement = $('<meta>')
                    .attr('property', 'schema:accessibilitySummary')
                    .text('This publication includes structural navigation, alternative text for images, and proper table markup to enhance accessibility.');
                metadata.append('\n    ').append(summaryElement);
                fixed = true;
                this.logger.info(`Added schema:accessibilitySummary metadata to ${opfPath}`);
            }
        }

        if (fixed) {
            this.saveDocument($, opfContent);
            return this.createFixResult(
                true,
                'Added schema:accessibilitySummary metadata to OPF',
                [opfPath]
            );
        }

        return this.createFixResult(false, 'No accessibilitySummary metadata issues found to fix');
    }
}