import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/dom";

// Testing Library's default async timeout is 1000ms. The heaviest UI flows
// (Vehicle Check end-to-end) take roughly 350-500ms on a development machine,
// which leaves almost no headroom on slower CI runners — they failed there
// with "Unable to find an element" while passing locally, on an identical
// dependency tree.
//
// This changes only how long a query may wait, never what it asserts: the same
// element with the same text must still appear, or the test still fails.
configure({ asyncUtilTimeout: 5000 });
