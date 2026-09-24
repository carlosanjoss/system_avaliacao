export function calculateAgreement(rows) {
  const pairs = rows.filter((row) => row.a1 && row.a2);
  if (!pairs.length) return { totalPareados: 0, concordantes: 0, percentual: null, kappa: null };

  const concordantes = pairs.filter((row) => row.a1 === row.a2).length;
  const percentual = concordantes / pairs.length;
  const aHate = pairs.filter((row) => row.a1 === 'hate').length / pairs.length;
  const bHate = pairs.filter((row) => row.a2 === 'hate').length / pairs.length;
  const esperado = (aHate * bHate) + ((1 - aHate) * (1 - bHate));
  const kappa = esperado === 1 ? (percentual === 1 ? 1 : 0) : (percentual - esperado) / (1 - esperado);

  return { totalPareados: pairs.length, concordantes, percentual, kappa };
}
