# Audio Duplicate Finder

CLI tool to scan audio files across your system, identify likely duplicates, and interactively manage them.

## Features

- Fast file discovery using ripgrep
- Extracts metadata (duration, bitrate, tags) from audio files
- Score-based duplicate detection with configurable thresholds
- Interactive review interface for deciding which files to keep
- Safe deletion via system trash (with permanent delete fallback)
- Resume support for interrupted scans

## Requirements

- Node.js 18+
- [ripgrep](https://github.com/BurntSushi/ripgrep) (`brew install ripgrep`)

## Installation

```bash
npm install
```

## Usage

### Step-by-step workflow

```bash
npm run scan          # Discover audio files and extract metadata
npm run find-dupes    # Analyze files and identify duplicate groups
npm run review        # Interactively review and decide on duplicates
npm run execute       # Execute deletions (moves to trash)
```

### All-in-one

```bash
npm start             # Guided workflow through all steps
```

## How It Works

### Scanning

Uses ripgrep to quickly find audio files across configured paths, then extracts metadata using the `music-metadata` library. Results are saved in NDJSON format for easy resume support.

**Supported formats:** mp3, flac, wav, aac, ogg, m4a, aiff, aif, alac, wma, opus, ape, wv

### Duplicate Detection

Files are compared using a score-based system:

- **Duration match (40 pts)** - Within ±5 seconds tolerance
- **Artist + Title match (30 pts)** - Case-insensitive tag comparison
- **Filename match (20 pts)** - Pattern extraction and fuzzy matching
- **Album match (10 pts)** - Case-insensitive comparison
- **Different location (10 pts)** - Files in different root folders

Files scoring ≥40 points are grouped as potential duplicates. Groups are built transitively (if A≈B and B≈C, then {A,B,C} are grouped together).

### Auto-suggestion

When reviewing duplicates, the tool suggests which file to keep based on:

- Most complete metadata (filled tags)
- Highest quality (lossless > higher bitrate > larger file)

### Deletion

Files are moved to the system trash using the `trash` package. If trash fails (e.g., external drives), falls back to permanent deletion with a warning.

## Configuration

Edit `config.json` to customize scan behavior:

```json
{
  "scanPaths": ["~", "/Volumes"],
  "excludePatterns": [
    "node_modules",
    ".git",
    "Library/Caches",
    "__pycache__",
    ".Trash",
    "*.app/Contents"
  ],
  "durationToleranceSeconds": 5,
  "duplicateScoreThreshold": 40,
  "supportedExtensions": ["mp3", "flac", "wav", "aac", "ogg", "m4a", "aiff", "aif", "alac", "wma", "opus", "ape", "wv"]
}
```

- **scanPaths** - Directories to scan (`~` expands to home directory)
- **excludePatterns** - Glob patterns to skip
- **durationToleranceSeconds** - How close durations must be to match
- **duplicateScoreThreshold** - Minimum score to consider files duplicates (lower = more matches)
- **supportedExtensions** - Audio file types to scan

## Data Files

All data is stored in the `data/` directory:

- `scan-results.ndjson` - Metadata for all scanned files
- `.scan-state.json` - Resume state for interrupted scans
- `duplicates.json` - Detected duplicate groups
- `decisions.json` - Your review decisions
- `deletion-log.json` - Log of executed deletions
