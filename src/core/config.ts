import { FixerConfig } from '../types';

export const defaultConfig: FixerConfig = {
    enabledFixers: [
        'missing-alt-text',
        'heading-structure',
        'landmarks',
        'language-attributes',
        'table-headers',
        'skip-links',
        'missing-metadata',
        'broken-links',
        'invalid-xhtml'
    ],
    accessibility: {
        addMissingAltText: true,
        fixHeadingStructure: true,
        addLandmarks: true,
        improveColorContrast: false, // Complex fix, often requires manual review
        addLanguageAttributes: true,
        fixTableHeaders: true,
        addSkipLinks: true
    },
    validation: {
        fixMissingMetadata: true,
        fixBrokenLinks: true,
        fixInvalidXhtml: true
    }
};

export function loadConfig(configPath?: string): FixerConfig {
    if (configPath) {
        try {
            const fs = require('fs');
            const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return { ...defaultConfig, ...userConfig };
        } catch (error) {
            console.warn(`Could not load config from ${configPath}, using defaults`);
            return defaultConfig;
        }
    }
    return defaultConfig;
}