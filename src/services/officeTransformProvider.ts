import { resolvePlatformCapabilities } from './platformCapabilities';
import { transformOfficeFile } from './nativeCapabilityBridge';

export type OfficeTransformOperation = 'inspect' | 'normalize' | 'to_xlsx' | 'to_docx' | 'to_pdf';

export async function runOfficeTransform(params: { inputPath: string; outputPath: string; operation: OfficeTransformOperation }) {
  const capabilities = resolvePlatformCapabilities();
  if (!capabilities.officeTransform) {
    throw new Error('当前平台不支持 Office 转换，请在桌面版或下载文件后处理。');
  }
  return transformOfficeFile(params);
}
