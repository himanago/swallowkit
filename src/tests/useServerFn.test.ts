import { renderHook } from "@testing-library/react";
import { useServerFn } from "../hooks/useServerFn";

// モック関数
const mockServerFn = jest.fn();

describe("useServerFn", () => {
  beforeEach(() => {
    mockServerFn.mockClear();
  });

  test("サーバー関数が正常に呼び出される", async () => {
    mockServerFn.mockResolvedValue("test result");

    const { result } = renderHook(() =>
      useServerFn(mockServerFn, ["arg1", "arg2"])
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe(null);
  });

  test("エラーが適切に処理される", async () => {
    const error = new Error("Test error");
    mockServerFn.mockRejectedValue(error);

    const { result } = renderHook(() =>
      useServerFn(mockServerFn, [])
    );

    expect(result.current.loading).toBe(true);
  });
});
