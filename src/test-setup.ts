import { configure } from '@testing-library/dom';

// findBy* and waitFor give up after 1 s by default. With every test file starting at once (PGlite DB files included)
// a first render can take longer, which made StagesPanel's "offers Open tournament" fail now and then. The suite's
// own testTimeout (30 s) still bounds a test that really hangs.
configure({ asyncUtilTimeout: 10_000 });
