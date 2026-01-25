import { createHash } from 'crypto';

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  dimension(): number;
  modelLabel(): string;
}

export class StubEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly dims = 768) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  dimension(): number {
    return this.dims;
  }

  modelLabel(): string {
    return 'stub-embedding-768';
  }

  private embedOne(text: string): number[] {
    const hash = createHash('sha256').update(text).digest();
    const vector = new Array(this.dims).fill(0).map((_, index) => {
      const byte = hash[index % hash.length];
      return (byte / 255) * 2 - 1;
    });
    return normalize(vector);
  }
}

function normalize(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}
