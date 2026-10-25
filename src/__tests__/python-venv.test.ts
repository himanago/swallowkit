import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { ensureUvVirtualEnvironment, getVirtualEnvPythonPath } from "../utils/python-uv";

let mockInterpreterError: Error | null = null;
jest.mock("child_process", () => ({
  execFile: jest.fn((
    _command: string,
    args: string[],
    _options: object,
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => callback(args[0] === "--version" ? mockInterpreterError : null, "Python 3.15.1\n", "")),
}));
jest.mock("fs", () => ({ existsSync: jest.fn() }));

describe("uv virtual environment lifecycle", () => {
  const cwd = path.resolve("python-fixture", "functions");
  const venv = path.join(cwd, ".venv");
  const env = { UV_PYTHON: "3.15", UV_PYTHON_DOWNLOADS: "never" };

  beforeEach(() => {
    jest.clearAllMocks();
    mockInterpreterError = null;
  });

  it("creates with normal uv selection, then checks that Python can actually execute", async () => {
    jest.mocked(fs.existsSync).mockReturnValue(false);
    await expect(ensureUvVirtualEnvironment("uv", venv, cwd, env)).resolves.toBe(getVirtualEnvPythonPath(venv));
    expect(execFile).toHaveBeenNthCalledWith(1, "uv", ["venv", venv], { cwd, env }, expect.any(Function));
    expect(execFile).toHaveBeenNthCalledWith(2, getVirtualEnvPythonPath(venv), ["--version"], { cwd, env }, expect.any(Function));
  });

  it("reuses an existing executable environment without changing its interpreter", async () => {
    jest.mocked(fs.existsSync).mockReturnValue(true);
    await ensureUvVirtualEnvironment("uv", venv, cwd, env);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile).toHaveBeenCalledWith(getVirtualEnvPythonPath(venv), ["--version"], { cwd, env }, expect.any(Function));
  });

  it.each([true, false])("reports blocked Python after checking the environment (existing=%s)", async exists => {
    jest.mocked(fs.existsSync).mockReturnValue(exists);
    mockInterpreterError = new Error("Application control blocked this file (os error 4551)");
    await expect(ensureUvVirtualEnvironment("uv", venv, cwd, env)).rejects.toThrow("os error 4551");
    expect(jest.mocked(execFile).mock.calls.some(call => call[1]?.includes("--clear"))).toBe(false);
    expect(execFile).toHaveBeenCalledTimes(exists ? 1 : 2);
  });
});
