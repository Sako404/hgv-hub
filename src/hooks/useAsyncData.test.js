// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAsyncData } from "./useAsyncData.js";

describe("useAsyncData", () => {
  it("starts loading, then resolves to the loaded data", async () => {
    const { result } = renderHook(() => useAsyncData(() => Promise.resolve("value"), []));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe("value");
    expect(result.current.error).toBeNull();
  });

  it("exposes a rejected loader as error, not a thrown exception", async () => {
    const { result } = renderHook(() => useAsyncData(() => Promise.reject(new Error("boom")), []));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error.message).toBe("boom");
  });

  it("reloads when deps change", async () => {
    let dep = "a";
    const { result, rerender } = renderHook(() => useAsyncData(() => Promise.resolve(dep), [dep]));

    await waitFor(() => expect(result.current.data).toBe("a"));

    dep = "b";
    rerender();
    await waitFor(() => expect(result.current.data).toBe("b"));
  });
});
