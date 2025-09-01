import * as fs from 'fs-extra';
import * as path from 'path';
import JSZip from 'jszip';
import * as xml2js from 'xml2js';
import {
    EpubMetadata,
    EpubManifest,
    ManifestItem,
    SpineItem,
    AccessibilityMetadata,
    EpubContent,
    ProcessingContext
} from '../types';
import { Logger, generateTempDir } from '../utils/common';

export class EpubParser {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    async extractEpub(epubPath: string): Promise<ProcessingContext> {
        this.logger.info(`Extracting EPUB: ${epubPath}`);

        const tempDir = generateTempDir();
        await fs.ensureDir(tempDir);

        try {
            // Read and extract EPUB file
            const epubBuffer = await fs.readFile(epubPath);
            const zip = await JSZip.loadAsync(epubBuffer);

            // Extract all files
            const contents = new Map<string, EpubContent>();

            for (const [filePath, file] of Object.entries(zip.files)) {
                if (!file.dir) {
                    const mediaType = this.getMediaType(filePath);
                    const fullPath = path.join(tempDir, filePath);
                    await fs.ensureDir(path.dirname(fullPath));

                    // Handle binary vs text files properly
                    let content: string | Buffer;
                    if (this.isBinaryFile(mediaType)) {
                        // For binary files, get buffer and save as buffer
                        const buffer = await file.async('nodebuffer');
                        await fs.writeFile(fullPath, buffer);
                        content = buffer;
                    } else {
                        // For text files, get as string
                        content = await file.async('string');
                        await fs.writeFile(fullPath, content, 'utf8');
                    }

                    contents.set(filePath, {
                        path: filePath,
                        content,
                        mediaType,
                        modified: false
                    });
                }
            }

            // Parse container.xml to find OPF file
            const containerPath = 'META-INF/container.xml';
            if (!contents.has(containerPath)) {
                throw new Error('Invalid EPUB: Missing META-INF/container.xml');
            }

            const opfPath = await this.parseContainer(contents.get(containerPath)!.content as string);
            if (!contents.has(opfPath)) {
                throw new Error(`Invalid EPUB: Missing OPF file at ${opfPath}`);
            }

            // Parse OPF file for metadata and manifest
            const opfContent = contents.get(opfPath)!.content as string;
            const { metadata, manifest } = await this.parseOpf(opfContent);

            const context: ProcessingContext = {
                epubPath,
                tempDir,
                manifest,
                metadata,
                contents,
                issues: [],
                fixes: [],
                config: {} as any // Will be set by caller
            };

            this.logger.success(`Successfully extracted EPUB to ${tempDir}`);
            return context;

        } catch (error) {
            await fs.remove(tempDir);
            throw new Error(`Failed to extract EPUB: ${error}`);
        }
    }

    private async parseContainer(containerXml: string): Promise<string> {
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(containerXml);

        const rootFiles = result.container?.rootfiles?.[0]?.rootfile;
        if (!rootFiles || rootFiles.length === 0) {
            throw new Error('Invalid container.xml: No rootfile found');
        }

        return rootFiles[0].$['full-path'];
    }

    private async parseOpf(opfXml: string): Promise<{ metadata: EpubMetadata; manifest: EpubManifest }> {
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(opfXml);

        const packageElement = result.package;
        if (!packageElement) {
            throw new Error('Invalid OPF: Missing package element');
        }

        // Parse metadata
        const metadataElement = packageElement.metadata?.[0];
        const metadata = this.parseMetadata(metadataElement);

        // Parse manifest
        const manifestElement = packageElement.manifest?.[0];
        const manifest = this.parseManifest(manifestElement, packageElement.spine?.[0]);

        return { metadata, manifest };
    }

    private parseMetadata(metadataElement: any): EpubMetadata {
        if (!metadataElement) {
            return {};
        }

        const dcElements = metadataElement['dc:title'] || [];
        const creators = metadataElement['dc:creator'] || [];
        const languages = metadataElement['dc:language'] || [];
        const identifiers = metadataElement['dc:identifier'] || [];
        const dates = metadataElement['dc:date'] || [];
        const publishers = metadataElement['dc:publisher'] || [];
        const descriptions = metadataElement['dc:description'] || [];
        const subjects = metadataElement['dc:subject'] || [];
        const rights = metadataElement['dc:rights'] || [];
        const meta = metadataElement.meta || [];

        const metadata: EpubMetadata = {
            title: dcElements.length > 0 ? this.getTextContent(dcElements[0]) : undefined,
            creator: creators.map((c: any) => this.getTextContent(c)),
            language: languages.length > 0 ? this.getTextContent(languages[0]) : undefined,
            identifier: identifiers.length > 0 ? this.getTextContent(identifiers[0]) : undefined,
            date: dates.length > 0 ? this.getTextContent(dates[0]) : undefined,
            publisher: publishers.length > 0 ? this.getTextContent(publishers[0]) : undefined,
            description: descriptions.length > 0 ? this.getTextContent(descriptions[0]) : undefined,
            subject: subjects.map((s: any) => this.getTextContent(s)),
            rights: rights.length > 0 ? this.getTextContent(rights[0]) : undefined,
            accessibility: this.parseAccessibilityMetadata(meta)
        };

        return metadata;
    }

    private parseAccessibilityMetadata(metaElements: any[]): AccessibilityMetadata {
        const accessibility: AccessibilityMetadata = {};

        for (const meta of metaElements) {
            const property = meta.$?.property;
            const content = this.getTextContent(meta);

            if (property && content) {
                switch (property) {
                    case 'schema:accessMode':
                        accessibility.accessMode = accessibility.accessMode || [];
                        accessibility.accessMode.push(content);
                        break;
                    case 'schema:accessModeSufficient':
                        accessibility.accessModeSufficient = accessibility.accessModeSufficient || [];
                        accessibility.accessModeSufficient.push(content);
                        break;
                    case 'schema:accessibilityFeature':
                        accessibility.accessibilityFeature = accessibility.accessibilityFeature || [];
                        accessibility.accessibilityFeature.push(content);
                        break;
                    case 'schema:accessibilityHazard':
                        accessibility.accessibilityHazard = accessibility.accessibilityHazard || [];
                        accessibility.accessibilityHazard.push(content);
                        break;
                    case 'schema:accessibilitySummary':
                        accessibility.accessibilitySummary = content;
                        break;
                }
            }
        }

        return accessibility;
    }

    private parseManifest(manifestElement: any, spineElement: any): EpubManifest {
        const items: ManifestItem[] = [];
        const spine: SpineItem[] = [];

        // Parse manifest items
        if (manifestElement?.item) {
            for (const item of manifestElement.item) {
                const manifestItem: ManifestItem = {
                    id: item.$.id,
                    href: item.$.href,
                    mediaType: item.$['media-type'],
                    properties: item.$.properties ? item.$.properties.split(' ') : undefined
                };
                items.push(manifestItem);
            }
        }

        // Parse spine items
        if (spineElement?.itemref) {
            for (const itemref of spineElement.itemref) {
                const spineItem: SpineItem = {
                    idref: itemref.$.idref,
                    linear: itemref.$.linear !== 'no'
                };
                spine.push(spineItem);
            }
        }

        return { items, spine };
    }

    private getTextContent(element: any): string {
        if (typeof element === 'string') {
            return element;
        }
        if (element._) {
            return element._;
        }
        if (element.$) {
            return element.$.toString();
        }
        return element.toString();
    }

    private getMediaType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const mediaTypes: { [key: string]: string } = {
            '.xhtml': 'application/xhtml+xml',
            '.html': 'text/html',
            '.xml': 'application/xml',
            '.opf': 'application/oebps-package+xml',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.mp3': 'audio/mpeg',
            '.mp4': 'video/mp4',
            '.pdf': 'application/pdf',
            '.epub': 'application/epub+zip'
        };

        return mediaTypes[ext] || 'application/octet-stream';
    }

    private isBinaryFile(mediaType: string): boolean {
        // Determine if a file should be treated as binary based on media type
        const binaryTypes = [
            'image/',
            'audio/',
            'video/',
            'application/pdf',
            'application/epub+zip',
            'application/octet-stream',
            'font/'
        ];

        // Text-based files that should never be treated as binary
        const textTypes = [
            'text/',
            'application/xml',
            'application/xhtml+xml',
            'application/oebps-package+xml',
            'application/javascript',
            'application/json'
        ];

        // Check if explicitly text-based first
        if (textTypes.some(type => mediaType.startsWith(type))) {
            return false;
        }

        return binaryTypes.some(type => mediaType.startsWith(type));
    }

    async getContentFiles(context: ProcessingContext): Promise<EpubContent[]> {
        const contentFiles: EpubContent[] = [];

        for (const item of context.manifest.items) {
            if (item.mediaType === 'application/xhtml+xml' || item.mediaType === 'text/html') {
                const content = context.contents.get(item.href);
                if (content && typeof content.content === 'string') {
                    contentFiles.push(content);
                }
            }
        }

        return contentFiles;
    }

    async repackageEpub(context: ProcessingContext, outputPath: string): Promise<void> {
        this.logger.info(`Repackaging EPUB to ${outputPath}`);

        const zip = new JSZip();

        // Add mimetype file first (uncompressed)
        zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

        // Add all other files
        for (const [filePath, content] of context.contents) {
            if (filePath !== 'mimetype') {
                // Handle binary vs text content properly
                if (content.content instanceof Buffer) {
                    // For binary files, add buffer directly
                    zip.file(filePath, content.content);
                } else {
                    // For text files, add as string
                    zip.file(filePath, content.content);
                }
            }
        }

        // Generate and save the EPUB
        const buffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 9 }
        });

        await fs.writeFile(outputPath, buffer);
        this.logger.success(`Successfully created fixed EPUB: ${outputPath}`);
    }
}