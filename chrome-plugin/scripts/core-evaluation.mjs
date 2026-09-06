function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function metric(truePositive, predicted, gold) {
  const precision = ratio(truePositive, predicted);
  const recall = ratio(truePositive, gold);
  return {
    truePositive,
    predicted,
    gold,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  };
}

function boundaryKey(component) {
  const start = component.startChar ?? component.startToken;
  const end = component.endChar ?? component.endToken;
  return `${start}:${end}`;
}

function characterComponent(component, tokens) {
  const start = tokens?.find(({ id }) => id === component.startToken);
  const end = tokens?.find(({ id }) => id === component.endToken);
  if (start === undefined || end === undefined) return component;
  return { ...component, startChar: start.start, endChar: end.end };
}

function normalizedCoordinates(sentences, coordinateSystem) {
  if (coordinateSystem !== "characters") return sentences ?? [];
  return (sentences ?? []).map((sentence) => ({
    ...sentence,
    components: (sentence.components ?? []).map((component) =>
      characterComponent(component, sentence.tokens),
    ),
  }));
}

function labeledKey(component) {
  return `${boundaryKey(component)}:${component.role}`;
}

function normalizedSentenceId(sentence) {
  return sentence?.sentenceId ?? sentence?.id;
}

function consumeMatches(gold, predicted, keyOf) {
  const available = new Map();
  for (const component of gold) {
    const key = keyOf(component);
    const queue = available.get(key) ?? [];
    queue.push(component);
    available.set(key, queue);
  }

  let count = 0;
  for (const component of predicted) {
    const queue = available.get(keyOf(component));
    if (queue?.length) {
      queue.shift();
      count += 1;
    }
  }
  return count;
}

function componentsEqualInOrder(gold, predicted) {
  return (
    gold.length === predicted.length &&
    gold.every(
      (component, index) =>
        boundaryKey(component) === boundaryKey(predicted[index] ?? {}) &&
        component.role === predicted[index]?.role,
    )
  );
}

function sentenceDetails(sentenceId, gold, predicted, status = "matched-sentence") {
  const remainingGold = [...gold];
  const missing = [];
  const extra = [];
  const roleErrors = [];

  for (const prediction of predicted) {
    const labeledIndex = remainingGold.findIndex(
      (expected) => labeledKey(expected) === labeledKey(prediction),
    );
    if (labeledIndex >= 0) {
      remainingGold.splice(labeledIndex, 1);
      continue;
    }

    const boundaryIndex = remainingGold.findIndex(
      (expected) => boundaryKey(expected) === boundaryKey(prediction),
    );
    if (boundaryIndex >= 0) {
      const expected = remainingGold.splice(boundaryIndex, 1)[0];
      roleErrors.push({
        startToken: prediction.startToken,
        endToken: prediction.endToken,
        expectedRole: expected.role,
        predictedRole: prediction.role,
      });
      continue;
    }

    extra.push(prediction);
  }
  missing.push(...remainingGold);

  return {
    sentenceId,
    status,
    exact: status === "matched-sentence" && componentsEqualInOrder(gold, predicted),
    missing,
    extra,
    roleErrors,
  };
}

function indexSentences(sentences) {
  const indexed = new Map();
  const duplicates = [];
  for (const sentence of sentences ?? []) {
    const sentenceId = normalizedSentenceId(sentence);
    if (indexed.has(sentenceId)) {
      duplicates.push(sentence);
    } else {
      indexed.set(sentenceId, sentence);
    }
  }
  return { indexed, duplicates };
}

export function scoreCorePredictions(goldSentences, predictedSentences, options = {}) {
  const gold = normalizedCoordinates(goldSentences, options.coordinateSystem);
  const predicted = normalizedCoordinates(predictedSentences, options.coordinateSystem);
  const goldIndex = indexSentences(gold).indexed;
  const predictionIndex = indexSentences(predicted);
  const details = [];
  let exactCount = 0;
  let spanMatches = 0;
  let labeledMatches = 0;
  let roleCorrect = 0;
  let roleMatched = 0;
  let goldSpanCount = 0;
  let predictedSpanCount = 0;
  let missingSentenceCount = 0;
  let extraSentenceCount = 0;

  for (const goldSentence of gold) {
    const sentenceId = normalizedSentenceId(goldSentence);
    const goldComponents = goldSentence.components ?? [];
    const prediction = predictionIndex.indexed.get(sentenceId);
    const predictedComponents = prediction?.components ?? [];
    goldSpanCount += goldComponents.length;

    if (!prediction) {
      missingSentenceCount += 1;
      details.push(sentenceDetails(sentenceId, goldComponents, [], "missing-sentence"));
      continue;
    }

    predictedSpanCount += predictedComponents.length;
    spanMatches += consumeMatches(goldComponents, predictedComponents, boundaryKey);
    labeledMatches += consumeMatches(goldComponents, predictedComponents, labeledKey);
    const detail = sentenceDetails(sentenceId, goldComponents, predictedComponents);
    roleMatched += spanMatchesForSentence(goldComponents, predictedComponents);
    roleCorrect += consumeMatches(goldComponents, predictedComponents, labeledKey);
    if (detail.exact) exactCount += 1;
    details.push(detail);
  }

  const firstPredictionById = new Set();
  for (const prediction of predicted) {
    const sentenceId = normalizedSentenceId(prediction);
    const duplicate = firstPredictionById.has(sentenceId);
    firstPredictionById.add(sentenceId);
    if (!goldIndex.has(sentenceId) || duplicate) {
      const components = prediction.components ?? [];
      predictedSpanCount += components.length;
      extraSentenceCount += 1;
      details.push(
        sentenceDetails(
          sentenceId,
          [],
          components,
          duplicate ? "duplicate-sentence" : "extra-sentence",
        ),
      );
    }
  }

  return {
    sentenceCount: gold.length,
    missingSentenceCount,
    extraSentenceCount,
    exactSentence: { count: exactCount, rate: ratio(exactCount, gold.length) },
    spanExact: metric(spanMatches, predictedSpanCount, goldSpanCount),
    labeledSpan: metric(labeledMatches, predictedSpanCount, goldSpanCount),
    roleAccuracyOnExactSpans: {
      correct: roleCorrect,
      matched: roleMatched,
      accuracy: ratio(roleCorrect, roleMatched),
    },
    details,
  };
}

function spanMatchesForSentence(gold, predicted) {
  return consumeMatches(gold, predicted, boundaryKey);
}

function exactIds(report) {
  return new Set(report.details.filter(({ exact }) => exact).map(({ sentenceId }) => sentenceId));
}

function transition(sentenceIds) {
  return { count: sentenceIds.length, sentenceIds };
}

export function scorePipelineTrace(goldSentences, trace, options = {}) {
  const denominatorIds = trace.denominatorSentenceIds ?? goldSentences.map(normalizedSentenceId);
  const denominatorSet = new Set(denominatorIds);
  const fixedGold = goldSentences.filter((sentence) =>
    denominatorSet.has(normalizedSentenceId(sentence)),
  );
  const firstPass = scoreCorePredictions(fixedGold, trace.firstPass.predictions, options);
  const final = scoreCorePredictions(fixedGold, trace.final.predictions, options);
  const firstExact = exactIds(firstPass);
  const finalExact = exactIds(final);
  const rejected = new Set(
    (trace.firstPass.validatorErrors ?? []).map(({ sentenceId }) => sentenceId),
  );
  const rejectedExact = denominatorIds.filter((id) => firstExact.has(id) && rejected.has(id));
  const errorKinds = new Map(
    (trace.firstPass.validatorErrors ?? []).map(({ sentenceId, kinds = [] }) => [
      sentenceId,
      kinds,
    ]),
  );
  const denominator = firstExact.size;

  return {
    denominator: fixedGold.length,
    firstPass,
    final,
    transitions: {
      repairedToCorrect: transition(
        denominatorIds.filter((id) => !firstExact.has(id) && finalExact.has(id)),
      ),
      correctToWrongOrFailure: transition(
        denominatorIds.filter((id) => firstExact.has(id) && !finalExact.has(id)),
      ),
      finalFailures: transition(
        denominatorIds.filter((id) => trace.final.failureSentenceIds?.includes(id)),
      ),
    },
    correctFirstPassRejection: {
      numerator: rejectedExact.length,
      denominator,
      rate: denominator === 0 ? null : rejectedExact.length / denominator,
      displayRate:
        denominator === 0 ? "N/A" : `${((rejectedExact.length / denominator) * 100).toFixed(2)}%`,
      grammarSentenceIds: rejectedExact.filter((id) => errorKinds.get(id)?.includes("grammar")),
      nonGrammarSentenceIds: rejectedExact.filter((id) =>
        errorKinds.get(id)?.includes("non-grammar"),
      ),
    },
  };
}

export function formatPipelineTransition(report) {
  const rejection = report.correctFirstPassRejection;
  return [
    `Correct first-pass rejection: ${rejection.displayRate}`,
    `Wrong to correct: ${report.transitions.repairedToCorrect.count}`,
    `Correct to wrong/failure: ${report.transitions.correctToWrongOrFailure.count}`,
    `Final failures: ${report.transitions.finalFailures.count}`,
  ].join("\n");
}

export function formatCoreEvaluation(report) {
  const percent = (value) => `${(value * 100).toFixed(2)}%`;
  return [
    `Sentences: ${report.sentenceCount} (missing ${report.missingSentenceCount}, extra ${report.extraSentenceCount})`,
    `Exact sentence: ${report.exactSentence.count}/${report.sentenceCount} (${percent(report.exactSentence.rate)})`,
    `Span exact P/R/F1: ${percent(report.spanExact.precision)} / ${percent(report.spanExact.recall)} / ${percent(report.spanExact.f1)}`,
    `Labeled span P/R/F1: ${percent(report.labeledSpan.precision)} / ${percent(report.labeledSpan.recall)} / ${percent(report.labeledSpan.f1)}`,
    `Role accuracy on exact spans: ${report.roleAccuracyOnExactSpans.correct}/${report.roleAccuracyOnExactSpans.matched} (${percent(report.roleAccuracyOnExactSpans.accuracy)})`,
  ].join("\n");
}
