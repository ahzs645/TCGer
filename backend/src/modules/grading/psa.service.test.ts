import {
  normalizePsaCertNumber,
  normalizePsaResponse,
  parsePsaGrade,
  psaSearchableName,
} from './psa.service';

describe('PSA certification normalization', () => {
  it('normalizes label input and extracts the numeric grade', () => {
    expect(normalizePsaCertNumber('12 34-5678')).toBe('12345678');
    expect(parsePsaGrade('GEM MT 10')).toBe(10);
    expect(parsePsaGrade('AUTHENTIC')).toBeUndefined();
  });

  it('retains a normalized subset and hashes the provider response', () => {
    const result = normalizePsaResponse(
      {
        PSACert: {
          CertNumber: '12345678',
          CardGrade: 'MINT 9',
          Subject: 'CHARIZARD-HOLO',
          CardNumber: '4',
        },
      },
      '12345678',
    );
    expect(result).toMatchObject({
      certNumber: '12345678',
      grade: 9,
      gradeLabel: 'MINT 9',
      subject: 'CHARIZARD-HOLO',
      searchableName: 'CHARIZARD',
      cardNumber: '4',
    });
    expect(result.providerResponseHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('removes printing noise from a searchable label', () => {
    expect(psaSearchableName('PIKACHU VMAX (SECRET)-HOLO')).toBe('PIKACHU VMAX');
  });
});
