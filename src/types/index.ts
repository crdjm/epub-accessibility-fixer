export interface EpubManifest {
    items: ManifestItem[];
    spine: SpineItem[];
}

export interface ManifestItem {
    id: string;
    href: string;
    mediaType: string;
    properties?: string[];
}

export interface SpineItem {
    idref: string;
    linear?: boolean;
}

export interface EpubMetadata {
    title?: string;
    creator?: string[];
    language?: string;
    identifier?: string;
    date?: string;
    publisher?: string;
    description?: string;
    subject?: string[];
    rights?: string;
    accessibility?: AccessibilityMetadata;
}

export interface AccessibilityMetadata {
    accessMode?: string[];
    accessModeSufficient?: string[];
    accessibilityFeature?: string[];
    accessibilityHazard?: string[];
    accessibilitySummary?: string;
}

export interface ValidationIssue {
    type: 'error' | 'warning' | 'info';
    category: 'validation' | 'accessibility';
    severity: 'critical' | 'major' | 'minor';
    code: string;
    message: string;
    location?: {
        file?: string;
        line?: number;
        column?: number;
        xpath?: string;
    };
    fixable: boolean;
    fixed?: boolean;
    details?: string;
}

export interface AccessibilityIssue extends ValidationIssue {
    category: 'accessibility';
    wcagLevel: 'A' | 'AA' | 'AAA';
    wcagCriteria: string[];
    impact: 'minor' | 'moderate' | 'serious' | 'critical';
    element?: string;
}

export interface FixResult {
    success: boolean;
    message: string;
    changedFiles?: string[];
    details?: any;
}

export interface AnalysisResult {
    epub: {
        path: string;
        title?: string;
        metadata: EpubMetadata;
        structure: EpubManifest;
    };
    validation: {
        valid: boolean;
        issues: ValidationIssue[];
    };
    accessibility: {
        issues: AccessibilityIssue[];
        score?: number;
    };
    summary: {
        totalIssues: number;
        criticalIssues: number;
        fixableIssues: number;
        fixedIssues: number;
    };
    outputFiles?: {
        daisyAce?: string;
        epubCheck?: string;
    };
}

export interface CliOptions {
    input: string;
    output?: string;
    analyze?: boolean;
    config?: string;
    verbose?: boolean;
    reportPath?: string;
    skipValidation?: boolean;
    skipAccessibility?: boolean;
    dryRun?: boolean;
    keepOutput?: boolean;
}

export interface FixerConfig {
    enabledFixers: string[];
    accessibility: {
        addMissingAltText: boolean;
        fixHeadingStructure: boolean;
        addLandmarks: boolean;
        improveColorContrast: boolean;
        addLanguageAttributes: boolean;
        fixTableHeaders: boolean;
        addSkipLinks: boolean;
    };
    validation: {
        fixMissingMetadata: boolean;
        fixBrokenLinks: boolean;
        fixInvalidXhtml: boolean;
    };
}

export interface EpubContent {
    path: string;
    content: string | Buffer;
    mediaType: string;
    modified: boolean;
}

export interface ProcessingContext {
    epubPath: string;
    tempDir: string;
    manifest: EpubManifest;
    metadata: EpubMetadata;
    contents: Map<string, EpubContent>;
    issues: ValidationIssue[];
    fixes: FixResult[];
    config: FixerConfig;
    options?: CliOptions;
}