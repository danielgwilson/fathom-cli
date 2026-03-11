import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import yazl from "yazl";
import { collectCursorPages, type FathomApiClient, type Meeting, type MeetingsListOptions } from "./fathom-api.js";
import {
  defaultExportDir,
  defaultZipPath,
  metadataMatchesQuery,
  renderMeetingMarkdown,
  renderMeetingText,
  safeMeetingStem,
} from "./format.js";

export type ExportFormat = "json" | "md" | "txt";

export type ExportMeetingsOptions = MeetingsListOptions & {
  all?: boolean;
  formats: ExportFormat[];
  maxItems?: number;
  outDir?: string;
  query?: string;
  zip?: boolean;
  zipPath?: string;
  onStatus?: (event: { msg: string; count?: number }) => void;
};

type WrittenFile = {
  path: string;
  bytes: number;
};

async function addDirectoryToZip(zip: yazl.ZipFile, dirPath: string, rootPath: string): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, entryPath, rootPath);
      continue;
    }
    const relativePath = path.relative(rootPath, entryPath);
    zip.addFile(entryPath, relativePath);
  }
}

async function writeZip(dirPath: string, zipPath: string): Promise<void> {
  const zip = new yazl.ZipFile();
  await addDirectoryToZip(zip, dirPath, dirPath);
  await new Promise<void>((resolve, reject) => {
    zip.outputStream
      .pipe(createWriteStream(zipPath))
      .on("close", () => resolve())
      .on("error", reject);
    zip.end();
  });
}

export async function exportMeetings(client: FathomApiClient, options: ExportMeetingsOptions): Promise<{
  exportDate: string;
  totalMeetings: number;
  successful: number;
  failed: Array<{ recording_id: number; message: string }>;
  outDir: string;
  zipPath: string | null;
  written: WrittenFile[];
}> {
  const outDir = options.outDir || defaultExportDir();
  const zipPath = options.zip || options.zipPath ? options.zipPath || defaultZipPath() : null;
  const failed: Array<{ recording_id: number; message: string }> = [];
  const written: WrittenFile[] = [];
  await fs.mkdir(outDir, { recursive: true });

  options.onStatus?.({ msg: "Listing meetings" });
  const collected = await collectCursorPages<Awaited<ReturnType<FathomApiClient["listMeetings"]>>, Meeting>({
    all: options.all,
    initialCursor: options.cursor,
    maxItems: options.maxItems,
    pageSize: options.pageSize,
    fetchPage: (cursor, pageSize) =>
      client.listMeetings({
        ...options,
        cursor,
        pageSize,
        includeActionItems: true,
        includeCrmMatches: true,
        includeSummary: true,
        includeTranscript: true,
      }),
    onPage: ({ collected }) => options.onStatus?.({ msg: "Scanning meetings", count: collected }),
  });

  const meetings: Meeting[] = options.query
    ? collected.items.filter((meeting) => metadataMatchesQuery(meeting, options.query!))
    : collected.items;

  for (const meeting of meetings) {
    const stem = safeMeetingStem(meeting);
    const meetingDir = path.join(outDir, stem);
    await fs.mkdir(meetingDir, { recursive: true });
    try {
      if (options.formats.includes("json")) {
        const filePath = path.join(meetingDir, "meeting.json");
        const payload = `${JSON.stringify(meeting, null, 2)}\n`;
        await fs.writeFile(filePath, payload, "utf8");
        written.push({ path: filePath, bytes: Buffer.byteLength(payload) });
      }
      if (options.formats.includes("md")) {
        const filePath = path.join(meetingDir, "meeting.md");
        const payload = `${renderMeetingMarkdown(meeting)}\n`;
        await fs.writeFile(filePath, payload, "utf8");
        written.push({ path: filePath, bytes: Buffer.byteLength(payload) });
      }
      if (options.formats.includes("txt")) {
        const filePath = path.join(meetingDir, "meeting.txt");
        const payload = `${renderMeetingText(meeting)}\n`;
        await fs.writeFile(filePath, payload, "utf8");
        written.push({ path: filePath, bytes: Buffer.byteLength(payload) });
      }
      options.onStatus?.({ msg: `Wrote ${stem}` });
    } catch (error: any) {
      failed.push({ recording_id: meeting.recording_id, message: error?.message || "Failed to write files" });
    }
  }

  const summary = {
    exportDate: new Date().toISOString(),
    totalMeetings: meetings.length,
    successful: meetings.length - failed.length,
    failed,
    outDir,
    zipPath,
    written,
  };

  const summaryPath = path.join(outDir, "export_summary.json");
  const summaryPayload = `${JSON.stringify(summary, null, 2)}\n`;
  await fs.writeFile(summaryPath, summaryPayload, "utf8");
  written.push({ path: summaryPath, bytes: Buffer.byteLength(summaryPayload) });

  if (zipPath) {
    options.onStatus?.({ msg: "Creating zip archive" });
    await writeZip(outDir, zipPath);
  }

  return summary;
}
