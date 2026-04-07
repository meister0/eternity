# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Active Plan

**READ FIRST**: [`PLAN.md`](./PLAN.md) — full specification for the Base/Affix-aware Search Generator feature currently being built. Contains data source schemas, tier indexing decisions, UX design, file structure, phased task breakdown, and parallel execution waves.

If you're picking up work in a fresh session, start with PLAN.md §0 ("How to resume").

## Development Commands

- `npm run dev` - Start development server at localhost:4321
- `npm run build` - Build production site to ./dist/
- `npm run preview` - Preview production build locally
- `npm run typecheck` - Run TypeScript type checking
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting

## Architecture Overview

This is an Astro-based web application for building Last Epoch stash search strings with an intuitive UI. The app generates complex search expressions using macros, regex patterns, and logical operators.

### Core Architecture

**Main Entry Point**: `src/pages/index.astro` renders the single-page application with `StashSearchBuilder.tsx` as the primary React component.

**State Management**: Central search state is managed in `StashSearchBuilder.tsx` using React hooks, with URL synchronization for sharing search configurations.

**Search Generation**: The core logic transforms UI state into Last Epoch stash search strings:

- `src/utils/search-parser.ts` - Bidirectional parsing between search strings and UI state
- `src/utils/url-state.ts` - URL state synchronization for shareable links

**Component Structure**:

- `src/components/sections/` - Feature-specific UI sections (Item Potential, Affix Tiers, etc.)
- `src/components/ui/` - Reusable UI components (inputs, checkboxes, containers)
- `src/types/stash-search.ts` - TypeScript definitions for all search state interfaces

**Data Layer**: `src/data/stash-macros.ts` contains all macro definitions, presets, and game-specific constants.

### Key Concepts

**Macro System**: Translates user-friendly inputs into Last Epoch's macro syntax (e.g., "LP3+" for "3 or more Legendary Potential")

**Expression Building**: Supports complex logical expressions using & (AND) and | (OR) operators between search terms

**Preset System**: Pre-configured search templates for common use cases stored in `SEARCH_PRESETS`

### Development Notes

- Uses Tailwind CSS v4 with Vite plugin for styling
- React components are TypeScript with strict typing
- Husky + lint-staged enforce code formatting on commits
- Automatic GitHub Pages deployment on push to master/main branch
