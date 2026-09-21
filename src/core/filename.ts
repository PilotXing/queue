/**
 * Pure helper module for Unicode-safe autosave filenames.
 */

export function sanitizeCategoryFilename(category: string): string {
    if (!category) return 'uncategorized';
    
    // Normalize string to NFC
    const normalized = category.normalize('NFC').trim();
    if (!normalized) return 'uncategorized';

    // Replace path-unsafe characters: / \ : * ? " < > |
    let safe = normalized.replace(/[\/\\:*?"<>|]/g, '_');
    
    // Replace whitespace with underscores
    safe = safe.replace(/\s+/g, '_');

    // Strip leading/trailing underscores or periods
    safe = safe.replace(/^[\._]+|[\._]+$/g, '');

    if (!safe) return 'uncategorized';

    // Hash whenever normalization changes the visible name, or when the category
    // contains case-sensitive letters. The latter prevents collisions on the
    // case-insensitive filesystems commonly used by macOS (for example Math/math).
    // CJK-only names remain clean and readable.
    const hasCaseSensitiveCharacter = Array.from(normalized).some(
        char => char.toLocaleLowerCase() !== char.toLocaleUpperCase()
    );
    if (safe !== normalized || hasCaseSensitiveCharacter) {
        const hash = simpleHash(normalized);
        safe = `${safe}_${hash}`;
    }

    return safe;
}

export function getAutosaveFilePath(category: string, folderPath: string = 'Practice_Sessions'): string {
    const fileName = sanitizeCategoryFilename(category);
    return `${folderPath}/autosave_${fileName}.md`;
}

function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
    }
    return Math.abs(hash).toString(36).slice(0, 6);
}
