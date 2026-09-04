import { resolvePlatformCapabilities } from './platformCapabilities';

export interface CommandRequest { command: string; args?: string[]; cwd?: string; timeoutMs?: number; }
export interface CommandResult { code: number; stdout: string; stderr: string; }

const COMMAND_ALLOWLIST = new Set(['python', 'python3', 'node', 'npm', 'git']);

function getElectronApi() {
  if (typeof window === 'undefined') return null;
  return (window as Window & { electronAPI?: {
    runCommand?: (request: CommandRequest) => Promise<CommandResult>;
    transformOffice?: (request: { inputPath: string; outputPath: string; operation: string }) => Promise<{ outputPath: string }>;
    systemAction?: (request: { action: 'open_path' | 'reveal_path'; target: string }) => Promise<{ ok: boolean }>;
  } }).electronAPI || null;
}

export async function runControlledCommand(request: CommandRequest): Promise<CommandResult> {
  const capabilities = resolvePlatformCapabilities();
  if (!capabilities.commandExecution) throw new Error('当前平台不支持命令执行');
  const command = request.command.trim();
  if (!COMMAND_ALLOWLIST.has(command)) throw new Error(`命令未被允许：${command}`);
  if ((request.args || []).some((arg) => /[;&|`$<>\n\r]/.test(arg))) throw new Error('命令参数包含不安全字符');
  const api = getElectronApi();
  if (!api?.runCommand) throw new Error('当前桌面运行时未提供受控命令接口');
  return api.runCommand({ ...request, command, args: (request.args || []).slice(0, 64), timeoutMs: Math.max(1000, Math.min(request.timeoutMs || 30_000, 120_000)) });
}

export async function transformOfficeFile(request: { inputPath: string; outputPath: string; operation: string }) {
  const capabilities = resolvePlatformCapabilities();
  if (!capabilities.officeTransform) throw new Error('当前平台不支持 Office 文档转换');
  if (!request.inputPath || !request.outputPath) throw new Error('Office 输入输出路径不能为空');
  const api = getElectronApi();
  if (!api?.transformOffice) throw new Error('当前桌面运行时未提供 Office 转换接口');
  return api.transformOffice({ ...request, operation: request.operation.slice(0, 120) });
}

export async function requestSystemAction(action: 'open_path' | 'reveal_path', target: string) {
  const capabilities = resolvePlatformCapabilities();
  if (!capabilities.systemActions) throw new Error('当前平台不支持系统操作');
  if (!target || target.includes('..')) throw new Error('系统操作目标路径无效');
  const api = getElectronApi();
  if (!api?.systemAction) throw new Error('当前桌面运行时未提供系统操作接口');
  return api.systemAction({ action, target });
}
