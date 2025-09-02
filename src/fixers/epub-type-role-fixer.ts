import { ValidationIssue, FixResult, ProcessingContext, EpubContent } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';

type Cheerio = any;
type CheerioStatic = any;

export class EpubTypeRoleFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'EPUB Type Role Fixer';
    }

    getHandledCodes(): string[] {
        return ['epub-type-has-matching-role'];
    }

    canFix(issue: ValidationIssue): boolean {
        // Log for debugging
        this.logger.info(`EpubTypeRoleFixer checking issue: code="${issue.code}", message="${issue.message}"`);
        
        // More comprehensive matching for epub:type to ARIA role issues
        const codeMatch = this.getHandledCodes().some(code => 
            issue.code.includes(code)
        );
        
        const messageMatch = issue.message.includes('epub:type') && 
                            (issue.message.includes('ARIA role') || 
                             issue.message.includes('role matching') ||
                             issue.message.includes('matching role'));
        
        const canFix = codeMatch || messageMatch;
        this.logger.info(`EpubTypeRoleFixer can fix issue: ${canFix ? 'yes' : 'no'} (codeMatch: ${codeMatch}, messageMatch: ${messageMatch})`);
        return canFix;
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing epub:type to ARIA role mapping: ${issue.message}`);

        try {
            const changedFiles: string[] = [];
            let totalFixed = 0;

            // If issue specifies a file, fix only that file
            if (issue.location?.file) {
                const content = this.findContentByPath(context, issue.location.file);
                if (content) {
                    const fixed = await this.fixEpubTypeRolesInFile(content, context);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                    }
                }
            } else {
                // Fix all content files
                const contentFiles = this.getAllContentFiles(context);

                for (const content of contentFiles) {
                    const fixed = await this.fixEpubTypeRolesInFile(content, context);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                    }
                }
            }

            if (totalFixed > 0) {
                return this.createFixResult(
                    true,
                    `Added matching ARIA roles for epub:type attributes in ${totalFixed} elements`,
                    changedFiles,
                    { elementsFixed: totalFixed }
                );
            } else {
                return this.createFixResult(
                    false,
                    'No epub:type elements found that needed ARIA role fixes'
                );
            }

        } catch (error) {
            this.logger.error(`EPUB type role fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix epub:type roles: ${error}`);
        }
    }

    private async fixEpubTypeRolesInFile(content: EpubContent, context: ProcessingContext): Promise<number> {
        const $ = this.loadDocument(content);
        let fixedCount = 0;

        // Map of common epub:type values to their corresponding ARIA roles
        const epubTypeToRoleMap: { [key: string]: string } = {
            'toc': 'doc-toc',
            'landmarks': 'navigation',
            'index': 'doc-index',
            'pagelist': 'doc-pagelist',
            'part': 'doc-part',
            'chapter': 'doc-chapter',
            'appendix': 'doc-appendix',
            'bibliography': 'doc-bibliography',
            'biblioentry': 'doc-biblioentry',
            'biblioref': 'doc-biblioentry',
            'glossary': 'doc-glossary',
            'glossdef': 'doc-glossdef',
            'glossref': 'doc-glossref',
            'glossterm': 'doc-glossterm',
            'introduction': 'doc-introduction',
            'noteref': 'doc-noteref',
            'notice': 'doc-notice',
            'pagebreak': 'doc-pagebreak',
            'preface': 'doc-preface',
            'prologue': 'doc-prologue',
            'pullquote': 'doc-pullquote',
            'subtitle': 'doc-subtitle',
            'tip': 'doc-tip',
            'titlepage': 'doc-titlepage',
            'bodymatter': 'doc-chapter', // Often used for main content
            'volume': 'doc-volume',
            'abstract': 'doc-abstract',
            'acknowledgments': 'doc-acknowledgments',
            'afterword': 'doc-afterword',
            'colophon': 'doc-colophon',
            'conclusion': 'doc-conclusion',
            'credit': 'doc-credit',
            'credits': 'doc-credits',
            'dedication': 'doc-dedication',
            'division': 'doc-division',
            'epigraph': 'doc-epigraph',
            'epilogue': 'doc-epilogue',
            'errata': 'doc-errata',
            'footnote': 'doc-footnote',
            'footnotes': 'doc-footnotes',
            'foreword': 'doc-foreword',
            'help': 'doc-help',
            'keyword': 'doc-keyword',
            'loi': 'doc-loi', // List of illustrations
            'lot': 'doc-lot', // List of tables
            'lov': 'doc-lov', // List of videos
            'other-credits': 'doc-other-credits',
            'rearnote': 'doc-rearnote',
            'rearnotes': 'doc-rearnotes',
            'sidebar': 'doc-sidebar',
            'warning': 'doc-warning'
        };

        // First pass: Add missing ARIA roles to all elements with epub:type attributes
        // We use a more conservative approach to avoid any potential duplication issues
        const elementsWithEpubType = $('[epub\\:type]').toArray();
        for (const element of elementsWithEpubType) {
            const $element = $(element);
            const epubType = $element.attr('epub:type');
            const tagName = $element.prop('tagName')?.toLowerCase();
            
            // Skip if no epub:type or already has role
            if (!epubType || $element.attr('role')) {
                continue;
            }
            
            // Handle multiple epub:type values (space-separated)
            const types = epubType.split(/\s+/);
            
            // Special handling for nav elements
            if (tagName === 'nav') {
                let roleAdded = false;
                for (const type of types) {
                    if (epubTypeToRoleMap[type]) {
                        $element.attr('role', epubTypeToRoleMap[type]);
                        fixedCount++;
                        roleAdded = true;
                        this.logger.info(`Added role="${epubTypeToRoleMap[type]}" for epub:type="${type}" on nav in ${content.path}`);
                        break; // Only add one role
                    }
                }
                
                // If no specific mapping found, use a generic appropriate role
                if (!roleAdded) {
                    // Default mappings for common nav types
                    if (types.includes('toc')) {
                        $element.attr('role', 'doc-toc');
                        fixedCount++;
                        this.logger.info(`Added role="doc-toc" for epub:type="toc" on nav in ${content.path}`);
                    } else if (types.includes('landmarks')) {
                        $element.attr('role', 'navigation');
                        fixedCount++;
                        this.logger.info(`Added role="navigation" for epub:type="landmarks" on nav in ${content.path}`);
                    }
                }
            }
            // Handle links
            else if (tagName === 'a') {
                for (const type of types) {
                    if (type === 'bodymatter') {
                        $element.attr('role', 'doc-biblioref');
                        fixedCount++;
                        this.logger.info(`Added role="doc-biblioref" for epub:type="bodymatter" on link in ${content.path}`);
                        break;
                    } else if (epubTypeToRoleMap[type]) {
                        $element.attr('role', epubTypeToRoleMap[type]);
                        fixedCount++;
                        this.logger.info(`Added role="${epubTypeToRoleMap[type]}" for epub:type="${type}" on link in ${content.path}`);
                        break;
                    }
                }
            }
            // Handle other elements
            else {
                for (const type of types) {
                    if (epubTypeToRoleMap[type]) {
                        $element.attr('role', epubTypeToRoleMap[type]);
                        fixedCount++;
                        this.logger.info(`Added role="${epubTypeToRoleMap[type]}" for epub:type="${type}" on ${tagName} in ${content.path}`);
                        break; // Only add one role
                    }
                }
            }
        }

        // Second pass: Correct existing ARIA roles that don't match epub:type
        const elementsWithBoth = $('[epub\\:type][role]').toArray();
        for (const element of elementsWithBoth) {
            const $element = $(element);
            const epubType = $element.attr('epub:type');
            const currentRole = $element.attr('role');
            const tagName = $element.prop('tagName')?.toLowerCase();
            
            if (!epubType || !currentRole) {
                continue;
            }
            
            // Verify the role matches the epub:type
            const types = epubType.split(/\s+/);
            let roleMatches = false;
            
            for (const type of types) {
                if (epubTypeToRoleMap[type] === currentRole) {
                    roleMatches = true;
                    break;
                }
            }
            
            // If role doesn't match, correct it
            if (!roleMatches) {
                // Special handling for links
                if (tagName === 'a') {
                    for (const type of types) {
                        if (type === 'bodymatter') {
                            $element.attr('role', 'doc-biblioref');
                            fixedCount++;
                            this.logger.info(`Corrected role from "${currentRole}" to "doc-biblioref" for epub:type="bodymatter" on link in ${content.path}`);
                            break;
                        } else if (epubTypeToRoleMap[type]) {
                            $element.attr('role', epubTypeToRoleMap[type]);
                            fixedCount++;
                            this.logger.info(`Corrected role from "${currentRole}" to "${epubTypeToRoleMap[type]}" for epub:type="${type}" on link in ${content.path}`);
                            break;
                        }
                    }
                } else {
                    for (const type of types) {
                        if (epubTypeToRoleMap[type]) {
                            $element.attr('role', epubTypeToRoleMap[type]);
                            fixedCount++;
                            this.logger.info(`Corrected role from "${currentRole}" to "${epubTypeToRoleMap[type]}" for epub:type="${type}" on ${tagName} in ${content.path}`);
                            break;
                        }
                    }
                }
            }
        }

        // Third pass: Remove duplicate nested elements with same epub:type and role
        // This addresses the specific issue where nested elements cause accessibility problems
        // We disable this pass for now as it seems to be causing content duplication issues
        // const elementsForDupCheck = $('[epub\\:type][role]').toArray();
        // for (const element of elementsForDupCheck) {
        //     const $element = $(element);
        //     const epubType = $element.attr('epub:type');
        //     const role = $element.attr('role');
        //     
        //     if (!epubType || !role) {
        //         continue;
        //     }
        //     
        //     // Look for direct parent elements with the same epub:type and role
        //     const $parent = $element.parent();
        //     if ($parent.length > 0) {
        //         const parentEpubType = $parent.attr('epub:type');
        //         const parentRole = $parent.attr('role');
        //         
        //         if (parentEpubType === epubType && parentRole === role) {
        //             this.logger.info(`Found duplicate nested element with same epub:type="${epubType}" and role="${role}" in ${content.path}`);
        //             // Remove the nested duplicate element, keeping only its children
        //             const innerContent = $element.contents();
        //             $element.replaceWith(innerContent);
        //             fixedCount++;
        //             this.logger.info(`Removed duplicate nested element with epub:type="${epubType}" and role="${role}" in ${content.path}`);
        //         }
        //     }
        // }

        if (fixedCount > 0) {
            this.saveDocument($, content);
            this.logger.info(`Fixed ${fixedCount} epub:type to ARIA role mappings in ${content.path}`);
        }

        return fixedCount;
    }
}