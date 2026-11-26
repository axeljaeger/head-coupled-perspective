import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision';

/** What the tracker needs from one detection, small enough to post between threads. */
export interface RawDetection {
  landmarks: NormalizedLandmark[] | null;
  /** Column-major 4x4 facial transformation matrix, if available. */
  matrix: number[] | null;
  detectMs: number;
}

/** Creates a Face Landmarker; `baseUrl` must point at the folder holding mediapipe/. */
export async function createLandmarker(baseUrl: string, useModule: boolean): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(`${baseUrl}mediapipe/wasm`, useModule);
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: `${baseUrl}mediapipe/face_landmarker.task`, delegate },
    runningMode: 'VIDEO' as const,
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
  });
  try {
    return await FaceLandmarker.createFromOptions(fileset, options('GPU'));
  } catch (e) {
    console.warn('GPU delegate failed, falling back to CPU', e);
    return await FaceLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

export function detect(landmarker: FaceLandmarker, image: TexImageSource, timestamp: number): RawDetection {
  const t0 = performance.now();
  const result = landmarker.detectForVideo(image, timestamp);
  const detectMs = performance.now() - t0;
  const m = result.facialTransformationMatrixes?.[0]?.data;
  return {
    landmarks: result.faceLandmarks[0] ?? null,
    matrix: m ? Array.from(m) : null,
    detectMs,
  };
}
