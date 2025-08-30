import { ValidationIssue, FixResult, ProcessingContext, EpubContent } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';

type CheerioStatic = any;

export class LanguageAttributeFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'Language Attribute Fixer';
    }

    getHandledCodes(): string[] {
        return [
            'missing-lang',
            'html-has-lang',
            'HTM-011',
            'OPF-025',
            'lang-xml',  // Additional DAISY ACE code
            'The element does not have a lang attribute'  // Specific message pattern
        ];
    }

    canFix(issue: ValidationIssue): boolean {
        // Check handled codes
        const codesMatch = this.getHandledCodes().some(code =>
            issue.code.includes(code) ||
            code.includes(issue.code)
        );

        if (codesMatch) {
            return true;
        }

        // Also check if the message contains the specific patterns we handle
        const messagePatterns = [
            'The element does not have a lang attribute',
            'does not have a lang attribute',
            'missing lang attribute',
            'html element missing language attribute'
        ];

        return messagePatterns.some(pattern =>
            issue.message.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing missing language attributes: ${issue.message}`);
        this.logger.info(`Issue code: ${issue.code}, Location: ${issue.location?.file || 'global'}`);

        try {
            const changedFiles: string[] = [];
            let totalFixed = 0;

            // Get language from metadata
            const defaultLanguage = this.getDefaultLanguage(context);

            if (!defaultLanguage) {
                // First try to detect language from content
                const detectedLanguage = await this.detectLanguageFromContent(context);
                if (detectedLanguage) {
                    // Update metadata
                    context.metadata.language = detectedLanguage;
                    this.logger.info(`Detected and set default language: ${detectedLanguage}`);
                } else {
                    // Fallback to English
                    context.metadata.language = 'en';
                    this.logger.info('No language detected, defaulting to English');
                }
            }

            const language = context.metadata.language || 'en';
            this.logger.info(`Using language: ${language} for fixes`);

            // If issue specifies a file, fix only that file
            if (issue.location?.file) {
                this.logger.info(`Issue specifies specific file: ${issue.location.file}`);
                const content = this.findContentByPath(context, issue.location.file);

                if (content) {
                    this.logger.info(`✓ Found content for file: ${content.path}`);
                    this.logger.info(`Content media type: ${content.mediaType}`);
                    if (typeof content.content === 'string') {
                        this.logger.info(`Content size: ${content.content.length} characters`);

                        const fixed = await this.fixLanguageInFile(content, language);
                        if (fixed > 0) {
                            changedFiles.push(content.path);
                            totalFixed += fixed;
                        } else {
                            // Check if already has language - this is common for subsequent calls
                            const $ = this.loadDocument(content);
                            const $html = $('html');
                            const existingLang = $html.attr('lang') || $html.attr('xml:lang');
                            if (existingLang) {
                                this.logger.info(`Language attribute already present in ${content.path}: ${existingLang}`);
                                return this.createFixResult(
                                    true,
                                    `Language attribute already present: ${existingLang}`,
                                    [],
                                    { language: existingLang, alreadyFixed: true }
                                );
                            }
                        }
                    } else {
                        this.logger.info(`Skipping binary file: ${content.path}`);
                    }
                } else {
                    this.logger.error(`✗ Could not find content for file: ${issue.location.file}`);
                    this.logger.info(`Available files in context:`);
                    let fileCount = 0;
                    for (const [path, content] of context.contents) {
                        fileCount++;
                        if (fileCount <= 10) { // Show first 10 files
                            this.logger.info(`  - ${path} (${content.mediaType})`);
                        }
                    }
                    if (fileCount > 10) {
                        this.logger.info(`  ... and ${fileCount - 10} more files`);
                    }
                    this.logger.info(`Total files in context: ${fileCount}`);
                }
            } else {
                // Fix all content files
                this.logger.info('Fixing language attributes in all content files');
                const contentFiles = this.getAllContentFiles(context);
                this.logger.info(`Found ${contentFiles.length} content files to check`);

                for (const content of contentFiles) {
                    const fixed = await this.fixLanguageInFile(content, language);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                    }
                }
            }

            // Also update OPF metadata if needed  
            const opfFixed = await this.fixOpfLanguage(context, language);
            if (opfFixed) {
                totalFixed++;
            }

            if (totalFixed > 0) {
                return this.createFixResult(
                    true,
                    `Added language attributes (${language}) to ${totalFixed} locations`,
                    changedFiles,
                    { language, locationsFixed: totalFixed }
                );
            } else {
                // More detailed logging for debugging
                this.logger.warn(`No language attributes were added. Issue details:`);
                this.logger.warn(`  - Issue code: ${issue.code}`);
                this.logger.warn(`  - Issue message: ${issue.message}`);
                this.logger.warn(`  - Issue location: ${issue.location?.file || 'No specific file'}`);
                this.logger.warn(`  - Default language used: ${language}`);

                if (issue.location?.file) {
                    const content = this.findContentByPath(context, issue.location.file);
                    if (content) {
                        const $ = this.loadDocument(content);
                        const $html = $('html');
                        const existingLang = $html.attr('lang') || $html.attr('xml:lang');
                        this.logger.warn(`  - HTML element lang attribute: ${existingLang || 'MISSING'}`);

                        const $body = $('body');
                        const bodyLang = $body.attr('lang') || $body.attr('xml:lang');
                        this.logger.warn(`  - Body element lang attribute: ${bodyLang || 'MISSING'}`);
                    }
                }

                return this.createFixResult(
                    false,
                    'No missing language attributes found to fix'
                );
            }

        } catch (error) {
            this.logger.error(`Language attribute fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix language attributes: ${error}`);
        }
    }

    private getDefaultLanguage(context: ProcessingContext): string | null {
        return context.metadata.language || null;
    }

    private async detectLanguageFromContent(context: ProcessingContext): Promise<string | null> {
        // Simple language detection based on common words
        const contentFiles = this.getAllContentFiles(context);
        let allText = '';

        for (const content of contentFiles.slice(0, 3)) { // Only check first few files
            const $ = this.loadDocument(content);
            const bodyText = $('body').text();
            allText += bodyText + ' ';

            if (allText.length > 1000) break; // Enough text for detection
        }

        return this.detectLanguageFromText(allText.trim());
    }

    private detectLanguageFromText(text: string): string | null {
        if (!text || text.length < 100) {
            return null;
        }

        const lowercaseText = text.toLowerCase();

        // Common words for different languages
        const languagePatterns = {
            'en': ['the', 'and', 'that', 'have', 'for', 'not', 'with', 'you', 'this', 'but'],
            'es': ['que', 'de', 'no', 'la', 'el', 'en', 'y', 'con', 'por', 'para'],
            'fr': ['que', 'de', 'et', 'à', 'un', 'il', 'être', 'et', 'en', 'avoir'],
            'de': ['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich'],
            'it': ['che', 'di', 'da', 'in', 'un', 'il', 'del', 'lei', 'per', 'con'],
            'pt': ['que', 'de', 'não', 'um', 'em', 'da', 'para', 'com', 'uma', 'na']
        };

        let bestMatch = { language: 'en', score: 0 };

        for (const [lang, words] of Object.entries(languagePatterns)) {
            let score = 0;
            for (const word of words) {
                // Count occurrences of whole words
                const regex = new RegExp(`\\b${word}\\b`, 'g');
                const matches = lowercaseText.match(regex);
                score += matches ? matches.length : 0;
            }

            if (score > bestMatch.score) {
                bestMatch = { language: lang, score };
            }
        }

        // Require minimum confidence
        if (bestMatch.score > 5) {
            return bestMatch.language;
        }

        return null;
    }

    private async fixLanguageInFile(content: EpubContent, language: string): Promise<number> {
        const $ = this.loadDocument(content);
        let fixedCount = 0;

        this.logger.info(`Checking language attributes in file: ${content.path}`);
        this.logger.info(`Target language: ${language}`);

        // Debug: Show first part of document structure
        const htmlElement = $('html').get(0);
        const documentStructure = $('html').length > 0 ?
            `<html ${htmlElement && (htmlElement as any).attribs ? Object.entries((htmlElement as any).attribs).map(([k, v]) => `${k}="${v}"`).join(' ') : 'no-attrs'}>` :
            'No HTML element found';
        this.logger.info(`Document structure: ${documentStructure}`);

        // Check html element
        const $html = $('html');
        this.logger.info(`HTML elements found: ${$html.length}`);

        if ($html.length > 0) {
            const existingLang = $html.attr('lang');
            const existingXmlLang = $html.attr('xml:lang');

            this.logger.info(`Existing lang attribute: ${existingLang || 'NONE'}`);
            this.logger.info(`Existing xml:lang attribute: ${existingXmlLang || 'NONE'}`);

            if (!existingLang && !existingXmlLang) {
                this.logger.info(`Adding lang attributes to HTML element...`);
                $html.attr('lang', language);
                $html.attr('xml:lang', language);
                fixedCount++;
                this.logger.info(`✓ Added language attributes to html element: ${language}`);

                // Verify the attributes were actually set
                const verifyLang = $html.attr('lang');
                const verifyXmlLang = $html.attr('xml:lang');
                this.logger.info(`Verification - lang: ${verifyLang}, xml:lang: ${verifyXmlLang}`);
            } else {
                this.logger.info(`HTML element already has language attributes, skipping`);
            }
        } else {
            this.logger.warn(`No HTML element found in ${content.path}`);

            // Debug: Show what elements ARE found
            const foundElements: string[] = [];
            $('*').each((_, el: any) => {
                if (foundElements.length < 5) { // Only show first 5
                    foundElements.push(el.tagName || el.name || 'unknown');
                }
            });
            this.logger.info(`Found elements: ${foundElements.join(', ')}`);
        }

        // Check body element (sometimes DAISY ACE flags this)
        const $body = $('body');
        if ($body.length > 0) {
            const existingLang = $body.attr('lang') || $body.attr('xml:lang');
            const parentLang = $body.parent().attr('lang') || $body.parent().attr('xml:lang');

            this.logger.info(`Body element - existing lang: ${existingLang || 'NONE'}, parent lang: ${parentLang || 'NONE'}`);

            // Only add lang to body if html doesn't have it and body doesn't have it
            if (!existingLang && !parentLang) {
                this.logger.info(`Adding lang attribute to body element...`);
                $body.attr('lang', language);
                fixedCount++;
                this.logger.info(`✓ Added language attribute to body element: ${language}`);
            }
        }

        // Check for any other elements that might need language attributes
        // Look for elements with text content that don't have lang attributes
        let elementsChecked = 0;
        $('p, div, span, h1, h2, h3, h4, h5, h6').each((_, element) => {
            const $element = $(element);
            const text = $element.text().trim();
            const hasLang = $element.attr('lang') || $element.attr('xml:lang');
            const parentHasLang = $element.parents('[lang], [xml\\:lang]').length > 0;

            elementsChecked++;

            // If element has substantial text but no language inheritance
            if (text.length > 50 && !hasLang && !parentHasLang) {
                $element.attr('lang', language);
                fixedCount++;
                this.logger.info(`✓ Added language attribute to ${element.tagName.toLowerCase()} element`);
            }
        });

        this.logger.info(`Checked ${elementsChecked} content elements for language attributes`);

        // Check for elements with different languages
        this.fixMixedLanguageContent($, language);

        // Check for elements that should have language specified
        $('[title], [alt]').each((_, element) => {
            const $element = $(element);
            const title = $element.attr('title');
            const alt = $element.attr('alt');

            // If title or alt text appears to be in a different language
            if (title || alt) {
                const detectedLang = this.detectLanguageFromText(title || alt || '');
                if (detectedLang && detectedLang !== language) {
                    if (!$element.attr('lang')) {
                        $element.attr('lang', detectedLang);
                        fixedCount++;
                        this.logger.info(`✓ Added language attribute to element with foreign text: ${detectedLang}`);
                    }
                }
            }
        });

        this.logger.info(`Total fixes applied in ${content.path}: ${fixedCount}`);

        if (fixedCount > 0) {
            this.logger.info(`Saving document with ${fixedCount} language attribute fixes...`);
            this.saveDocument($, content);
            this.logger.info(`✓ Document saved successfully`);
        } else {
            this.logger.warn(`No language attributes were added to ${content.path}`);
        }

        return fixedCount;
    }

    private fixMixedLanguageContent($: CheerioStatic, defaultLanguage: string): void {
        // Look for quotes or text that might be in different languages
        $('q, blockquote, cite').each((_, element) => {
            const $element = $(element);
            const text = $element.text();

            if (text && text.length > 20) {
                const detectedLang = this.detectLanguageFromText(text);
                if (detectedLang && detectedLang !== defaultLanguage) {
                    if (!$element.attr('lang')) {
                        $element.attr('lang', detectedLang);
                        this.logger.info(`Added language attribute to quote/citation: ${detectedLang}`);
                    }
                }
            }
        });

        // Look for spans or divs with foreign content
        $('span, div').each((_, element) => {
            const $element = $(element);
            const className = $element.attr('class') || '';

            // Check for language-indicating class names
            const langMatch = className.match(/\b(lang|language)[-_]([a-z]{2,3})\b/i);
            if (langMatch) {
                const lang = langMatch[2].toLowerCase();
                if (!$element.attr('lang')) {
                    $element.attr('lang', lang);
                    this.logger.info(`Added language attribute based on class name: ${lang}`);
                }
            }
        });
    }

    private async fixOpfLanguage(context: ProcessingContext, language: string): Promise<boolean> {
        // Find OPF file
        let opfContent: any = null;

        for (const [path, content] of context.contents) {
            if (path.endsWith('.opf') || content.mediaType === 'application/oebps-package+xml') {
                opfContent = content;
                break;
            }
        }

        if (!opfContent) {
            return false;
        }

        const $ = this.loadDocument(opfContent);
        let fixed = false;

        // Check for existing language metadata
        const existingLang = $('dc\\:language, language').first();

        if (existingLang.length === 0) {
            // Add language metadata
            const metadata = $('metadata');
            if (metadata.length > 0) {
                metadata.append(`<dc:language>${language}</dc:language>`);
                fixed = true;
                this.logger.info(`Added language metadata to OPF: ${language}`);
            }
        } else if (!existingLang.text().trim()) {
            // Update empty language element
            existingLang.text(language);
            fixed = true;
            this.logger.info(`Updated empty language metadata in OPF: ${language}`);
        }

        if (fixed) {
            this.saveDocument($, opfContent);
        }

        return fixed;
    }
}