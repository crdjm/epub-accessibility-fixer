import * as path from 'path';
import * as fs from 'fs-extra';
import * as JSZip from 'jszip';
import { Logger } from './common';

export interface EpubVersionInfo {
    version: string;
    isEpub2: boolean;
    isEpub3: boolean;
    majorVersion: number;
    minorVersion: number;
}

export class EpubVersionDetector {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * Detect EPUB version from an EPUB file
     */
    async detectVersion(epubPath: string): Promise<EpubVersionInfo> {
        this.logger.info(`Detecting EPUB version for: ${epubPath}`);

        if (!await fs.pathExists(epubPath)) {
            throw new Error(`EPUB file not found: ${epubPath}`);
        }

        const zipBuffer = await fs.readFile(epubPath);
        const zip = await JSZip.loadAsync(zipBuffer);

        // First, find the OPF file from container.xml
        const containerFile = zip.file('META-INF/container.xml');
        if (!containerFile) {
            throw new Error('Invalid EPUB: Missing META-INF/container.xml');
        }

        const containerContent = await containerFile.async('string');
        const opfPath = this.extractOpfPath(containerContent);

        if (!opfPath) {
            throw new Error('Invalid EPUB: Cannot find OPF file path in container.xml');
        }

        // Read the OPF file
        const opfFile = zip.file(opfPath);
        if (!opfFile) {
            throw new Error(`Invalid EPUB: OPF file not found at ${opfPath}`);
        }

        const opfContent = await opfFile.async('string');
        return this.parseVersionFromOpf(opfContent);
    }

    /**
     * Extract OPF file path from container.xml
     */
    private extractOpfPath(containerXml: string): string | null {
        // Simple regex to extract full-path from container.xml
        const match = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/);
        return match ? match[1] : null;
    }

    /**
     * Parse EPUB version from OPF content
     */
    private parseVersionFromOpf(opfContent: string): EpubVersionInfo {
        // Extract version from package element
        const packageMatch = opfContent.match(/<package[^>]*version\s*=\s*["']([^"']+)["']/);

        if (!packageMatch) {
            this.logger.warn('No version attribute found in package element, assuming EPUB 2.0');
            return this.createVersionInfo('2.0');
        }

        const version = packageMatch[1];
        this.logger.info(`Detected EPUB version: ${version}`);

        return this.createVersionInfo(version);
    }

    /**
     * Create version info object from version string
     */
    private createVersionInfo(version: string): EpubVersionInfo {
        const versionParts = version.split('.');
        const majorVersion = parseInt(versionParts[0] || '2');
        const minorVersion = parseInt(versionParts[1] || '0');

        return {
            version,
            isEpub2: majorVersion === 2,
            isEpub3: majorVersion >= 3,
            majorVersion,
            minorVersion
        };
    }

    /**
     * Quick check if an EPUB is version 2.0
     */
    async isEpub2(epubPath: string): Promise<boolean> {
        const versionInfo = await this.detectVersion(epubPath);
        return versionInfo.isEpub2;
    }

    /**
     * Quick check if an EPUB is version 3.0 or later
     */
    async isEpub3(epubPath: string): Promise<boolean> {
        const versionInfo = await this.detectVersion(epubPath);
        return versionInfo.isEpub3;
    }
}