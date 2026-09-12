# Filament Painting Lab

Filament Painting Lab is a local-first Windows desktop application for turning source images into planned multi-color filament paintings for 3D printing.

The project combines image preparation, physical print constraints, filament inventory, height mapping, and color-change planning into one workflow.

## Portfolio overview

### The problem

Creating a filament painting involves more than converting an image to grayscale.

The user has to coordinate:

- Image preparation
- Printable layer heights
- Overall physical height
- Available filament colors
- Color ordering
- Height-band assignments
- Layer-change timing
- Printer-compatible measurements

Filament Painting Lab was created to bring those decisions into one repeatable desktop workflow instead of relying on disconnected calculations and manual notes.

### What it does

The current application supports:

- Importing PNG, JPG, and WEBP source images
- Non-destructive cropping and rotation
- Brightness, contrast, shadow, and highlight adjustments
- Grayscale luminance preview
- Banded height-map generation
- Configurable layer count and printer layer height
- Minimum and maximum physical-height controls
- Inverted height mapping
- Filament inventory with brand, material, color, and TD fields
- Project-specific palette selection
- Assigning filament colors to height ranges
- Automatic distribution of color ranges
- Color-sequence reordering
- Calculated filament-change layers and Z heights
- Height-map PNG export
- Color-change schedule export
- Local project persistence
- Backup and recovery of saved application state

Imported source images and project data remain local to the user's computer and are stored outside the GitHub repository.

### Why I built it

I wanted to turn a specialized creative workflow into a structured tool rather than rely on repeated manual calculations.

The project required translating a real-world process into software rules:

- Which user inputs affect the final print?
- Which values need to be constrained to physically printable increments?
- How should colors map to height ranges?
- How should project state survive restarts?
- How can exports be verified rather than simply assuming a file write succeeded?
- How can image edits remain reversible instead of modifying the original source?

The result is a functioning workflow tool rather than a standalone calculator or image filter.

### My role

I own the product concept, workflow design, requirements, testing, and development direction for Filament Painting Lab.

My work includes:

- Breaking the filament-painting process into software workflows
- Defining application behavior and project requirements
- Designing the relationship between image data, physical print settings, and filament choices
- Defining validation and input constraints
- Reviewing and testing implementation behavior
- Identifying workflow and usability problems
- Iterating features through milestone-based development
- Validating persistence, backup, recovery, and exports
- Maintaining the project's implementation direction

Development is AI-assisted, with generated implementation reviewed against the intended workflow and tested before acceptance.

### Implementation approach

Filament Painting Lab is built as an Electron desktop application.

The application uses:

- Electron for the Windows desktop environment
- A restricted preload bridge between the renderer and main process
- Local JSON persistence
- Local image storage
- Canvas-based image processing and previews
- Deterministic calculations for layer and height planning
- Windows save dialogs for project outputs

Application data and imported images are stored in the application's local data directory rather than source control.

### Reliability and data handling

The project includes several safeguards intended to make local project work more dependable.

Saved application state uses:

1. A temporary write
2. Validation of the temporary data
3. Replacement of the active save
4. A second read-back verification

The previous save is retained as a backup for recovery.

Exported height maps and color-change schedules are also checked after writing instead of treating the filesystem operation alone as proof of success.

Original imported images remain unchanged. Image adjustments are stored as project settings and applied when the application renders its previews.

### Current status

Filament Painting Lab is an actively developed personal project.

The current version has a functioning image-to-height-map and palette-planning workflow. Future work may expand areas such as transmission-distance modeling, optical color blending, palette optimization, segmentation, and direct 3D-print export.

---

## Development milestone 5

The current runnable version includes:

- Electron desktop window
- Purple Projects, Image, Height Map, Palette, Inventory, Layers, and Settings interface
- Verified local JSON saving with backup recovery
- Persistent source-image storage outside the GitHub repository
- Non-destructive crop, rotation, brightness, contrast, shadow, and highlight controls
- Grayscale luminance preview
- Banded height-map generation from the prepared image
- Selectable height-band count and printer layer height
- Minimum and maximum physical height controls snapped to printable layer increments
- Invert-height option
- Verified height-map PNG export through a Windows save dialog
- Project palette selection from the local filament inventory
- Height-band ranges assigned to specific filaments
- Direct filament-color preview using inventory hex colors
- Color-sequence reordering and automatic range distribution
- Calculated color-change layers, Z heights, and covered target-height ranges
- Verified text export of the color-change schedule
- Saved palette settings that return after restart
- Manual TD fields preserved for the later optical model

The original imported image remains untouched. Image preparation, height mapping, and palette previews are all rendered from the saved original plus project settings.

The height-map and palette previews use the working preview resolution, capped at 1,400 pixels on the longest edge.

Milestone 5 uses direct solid filament colors. It does not yet simulate transmission distance, optical blending, layer transparency, automatic palette optimization, segmentation, STL export, or 3MF export.

## First run

1. Open GitHub Desktop and select this repository.
2. Click **Fetch origin**, then **Pull origin** if shown.
3. Open the repository folder.
4. Double-click `setup.bat` and wait for **Setup complete**.
5. Double-click `start.bat`.

Later, open the app by double-clicking `start.bat`.

The app shows the exact local data-file location under **Settings**. Your project data and imported images are not stored in GitHub.

PowerShell users should use `npm.cmd` because Windows may block the `npm.ps1` wrapper:

```powershell
npm.cmd install
npm.cmd start
npm.cmd run check
```
