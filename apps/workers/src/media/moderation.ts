import {
  CompareFacesCommand,
  DetectFacesCommand,
  DetectModerationLabelsCommand,
  InvalidParameterException,
  type RekognitionClient,
} from '@aws-sdk/client-rekognition';

export const MODERATION = Symbol('MODERATION');

export interface ModerationLabel {
  name: string;
  parent: string | null;
  confidence: number;
}

export interface Moderation {
  /** Content labels for an image (nudity, violence, ...). */
  labels(image: Buffer): Promise<ModerationLabel[]>;
  /** Number of clearly visible faces. */
  countFaces(image: Buffer): Promise<number>;
  /** Highest similarity (0-100) of the face in `source` to any face in the target object; 0 if none. */
  compareFaces(source: Buffer, target: { bucket: string; key: string }): Promise<number>;
}

/**
 * Rekognition moderation taxonomy (v7) categories a dating profile photo may not contain.
 * Swimwear is allowed; explicit content, violence, hate symbols and gore are not.
 */
export const BLOCKED_CATEGORIES = new Set([
  'Explicit',
  'Explicit Nudity',
  'Explicit Sexual Activity',
  'Non-Explicit Nudity of Intimate parts and Kissing',
  'Violence',
  'Graphic Violence',
  'Visually Disturbing',
  'Hate Symbols',
]);

/** Returns the first blocked label, if any. */
export function blockedLabel(labels: ModerationLabel[]): ModerationLabel | undefined {
  return labels.find(
    (l) => BLOCKED_CATEGORIES.has(l.name) || (l.parent && BLOCKED_CATEGORIES.has(l.parent)),
  );
}

export class RekognitionModeration implements Moderation {
  constructor(
    private readonly client: RekognitionClient,
    private readonly minConfidence: number,
  ) {}

  async labels(image: Buffer): Promise<ModerationLabel[]> {
    const res = await this.client.send(
      new DetectModerationLabelsCommand({
        Image: { Bytes: image },
        MinConfidence: this.minConfidence,
      }),
    );
    return (res.ModerationLabels ?? []).map((l) => ({
      name: l.Name ?? '',
      parent: l.ParentName || null,
      confidence: l.Confidence ?? 0,
    }));
  }

  async countFaces(image: Buffer): Promise<number> {
    const res = await this.client.send(
      new DetectFacesCommand({ Image: { Bytes: image }, Attributes: ['DEFAULT'] }),
    );
    return (res.FaceDetails ?? []).filter((f) => (f.Confidence ?? 0) >= 90).length;
  }

  async compareFaces(source: Buffer, target: { bucket: string; key: string }): Promise<number> {
    try {
      const res = await this.client.send(
        new CompareFacesCommand({
          SourceImage: { Bytes: source },
          TargetImage: { S3Object: { Bucket: target.bucket, Name: target.key } },
          SimilarityThreshold: 0,
          QualityFilter: 'AUTO',
        }),
      );
      return Math.max(0, ...(res.FaceMatches ?? []).map((m) => m.Similarity ?? 0));
    } catch (err) {
      // No face in the target photo (e.g. a landscape shot): not a match, not a failure.
      if (err instanceof InvalidParameterException) return 0;
      throw err;
    }
  }
}

/** Local development only: approves everything so the app works without AWS. */
export class NoopModeration implements Moderation {
  async labels(): Promise<ModerationLabel[]> {
    return [];
  }
  async countFaces(): Promise<number> {
    return 1;
  }
  async compareFaces(): Promise<number> {
    return 99;
  }
}
