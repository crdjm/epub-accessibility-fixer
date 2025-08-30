export { EpubAccessibilityProcessor } from './core/epub-processor';
export { Logger } from './utils/common';
export { loadConfig, defaultConfig } from './core/config';
export * from './types';

// For programmatic usage
import { EpubAccessibilityProcessor } from './core/epub-processor';
import { Logger } from './utils/common';
import { loadConfig } from './core/config';

/**
 * Quick function to analyze an EPUB file
 * @param epubPath Path to the EPUB file
 * @param verbose Enable verbose logging
 * @returns Analysis result
 */
export async function analyzeEpub(epubPath: string, verbose: boolean = false) {
    const logger = new Logger(verbose);
    const processor = new EpubAccessibilityProcessor(logger);
    const config = loadConfig();

    return processor.analyzeOnly(epubPath, config);
}

/**
 * Quick function to fix an EPUB file
 * @param inputPath Path to the input EPUB file
 * @param outputPath Path for the output EPUB file
 * @param reportPath Optional path for the HTML report
 * @param verbose Enable verbose logging
 * @returns Analysis result with fix information
 */
export async function fixEpub(
    inputPath: string,
    outputPath: string,
    reportPath?: string,
    verbose: boolean = false
) {
    const logger = new Logger(verbose);
    const processor = new EpubAccessibilityProcessor(logger);
    const config = loadConfig();

    return processor.fixEpub(inputPath, outputPath, config, reportPath);
}

/**
 * Quick function to validate an EPUB file
 * @param epubPath Path to the EPUB file
 * @param verbose Enable verbose logging
 * @returns Validation result
 */
export async function validateEpub(epubPath: string, verbose: boolean = false) {
    const logger = new Logger(verbose);
    const processor = new EpubAccessibilityProcessor(logger);

    return processor.validateEpubOnly(epubPath);
}