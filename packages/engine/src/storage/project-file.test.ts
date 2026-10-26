import { describe, expect, it } from "vitest";
import { emptyProject } from "../project/fixtures.test-util";
import { PROJECT_FORMAT, parseProject, ProjectFileError, safeFileName, serializeProject } from "./project-file";

describe("project files", () => {
  it("round-trips a project and its media descriptions", () => {
    const project = emptyProject();
    const saved = parseProject(serializeProject(project, { video: { name: "video.mp4", type: "video/mp4" } }));
    expect(saved.project).toEqual(project);
    expect(saved.media).toEqual({ video: { name: "video.mp4", type: "video/mp4" } });
  });

  it("rejects files that aren't Akira projects", () => {
    expect(() => parseProject("not json")).toThrow("damaged");
    expect(() => parseProject('{"some":"thing"}')).toThrow("isn't an Akira project");
    expect(() => parseProject('{"app":"akira","format":1,"project":{}}')).toThrow(ProjectFileError);
  });

  it("asks for an update to open projects from a newer version", () => {
    const newer = JSON.stringify({ app: "akira", format: PROJECT_FORMAT + 1, project: emptyProject() });
    expect(() => parseProject(newer)).toThrow("newer version");
  });

  it("restores the main track if a project somehow lost it", () => {
    const project = { ...emptyProject(), tracks: [] };
    expect(parseProject(serializeProject(project)).project.tracks).toHaveLength(1);
  });

  it("makes names safe to store", () => {
    expect(safeFileName("clip.mp4")).toBe("clip.mp4");
    expect(safeFileName('a/b\\c:d*?"<>|.mov')).toBe("a_b_c_d______.mov");
    expect(safeFileName("..")).toBe("media");
  });
});
