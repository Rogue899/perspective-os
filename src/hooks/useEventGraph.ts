import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GdeltArticle } from '../services/gdelt';
import {
  buildEventHistoryTimeline,
  extractEventGraphSearchTerms,
  fetchEventGraphHistoryContext,
  synthesizeEventHistory,
  type EventGraphActorEntry,
} from '../services/event-graph';
import {
  createEventGraphFromCluster,
  createHistoricalContextGraph,
  mergeEventGraphBundles,
} from '../utils/event-graph';
import type { EventGraphBundle, HistoricalContextItem, StoryCluster } from '../types';

interface UseEventGraphOptions {
  loadHistorical?: boolean;
}

interface UseEventGraphResult {
  searchTerms: string[];
  liveGraph: EventGraphBundle;
  historicalGraph: EventGraphBundle;
  graph: EventGraphBundle;
  historyItems: HistoricalContextItem[];
  gdeltArticles: GdeltArticle[];
  actors: EventGraphActorEntry[];
  aiSummary: string;
  loading: boolean;
  synthLoading: boolean;
  timelineRows: string[];
  runHistorySynthesis: () => Promise<void>;
}

const EMPTY_BUNDLE: EventGraphBundle = {
  events: [],
  claims: [],
  entities: [],
  places: [],
  sourceDocuments: [],
  evidence: [],
  edges: [],
  perspectiveViews: [],
};

export function useEventGraph(cluster: StoryCluster | null, options: UseEventGraphOptions = {}): UseEventGraphResult {
  return useEventGraphSubject(cluster, options);
}

export function useEventGraphSubject(subject: StoryCluster | StoryCluster[] | null, options: UseEventGraphOptions = {}): UseEventGraphResult {
  const loadHistorical = options.loadHistorical ?? false;
  const [historyItems, setHistoryItems] = useState<HistoricalContextItem[]>([]);
  const [gdeltArticles, setGdeltArticles] = useState<GdeltArticle[]>([]);
  const [actors, setActors] = useState<EventGraphActorEntry[]>([]);
  const [aiSummary, setAiSummary] = useState('');
  const [loading, setLoading] = useState(loadHistorical);
  const [synthLoading, setSynthLoading] = useState(false);

  const clusterList = useMemo(
    () => (subject ? (Array.isArray(subject) ? subject : [subject]) : []).filter(Boolean),
    [subject],
  );
  const primaryCluster = clusterList[0] ?? null;
  const subjectLabel = useMemo(() => {
    if (clusterList.length === 0) return 'Current event graph';
    if (clusterList.length === 1) return clusterList[0].headline;
    const geoName = clusterList.find(cluster => cluster.geoHint?.name)?.geoHint?.name;
    return geoName ? `${geoName} area event graph` : `${clusterList.length} nearby events`;
  }, [clusterList]);
  const searchTerms = useMemo(() => (clusterList.length > 0 ? extractEventGraphSearchTerms(clusterList) : []), [clusterList]);
  const timelineRows = useMemo(() => (clusterList.length > 0 ? buildEventHistoryTimeline(clusterList) : []), [clusterList]);
  const liveGraph = useMemo(
    () => clusterList.length > 0
      ? mergeEventGraphBundles(...clusterList.map(item => createEventGraphFromCluster(item)))
      : EMPTY_BUNDLE,
    [clusterList],
  );
  const eventNode = liveGraph.events[0];
  const historicalGraph = useMemo(
    () => (loadHistorical && eventNode ? createHistoricalContextGraph(eventNode, historyItems) : EMPTY_BUNDLE),
    [eventNode, historyItems, loadHistorical],
  );
  const graph = useMemo(
    () => mergeEventGraphBundles(liveGraph, historicalGraph),
    [liveGraph, historicalGraph],
  );

  useEffect(() => {
    let cancelled = false;

    if (!primaryCluster || !loadHistorical) {
      setHistoryItems([]);
      setGdeltArticles([]);
      setActors([]);
      setAiSummary('');
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setHistoryItems([]);
    setGdeltArticles([]);
    setActors([]);
    setAiSummary('');
    setLoading(true);

    fetchEventGraphHistoryContext(clusterList, searchTerms)
      .then(result => {
        if (cancelled) return;
        setHistoryItems(result.historyItems);
        setGdeltArticles(result.gdeltArticles);
        setActors(result.actors);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clusterList, loadHistorical, primaryCluster, searchTerms]);

  const runHistorySynthesis = useCallback(async () => {
    if (!primaryCluster || !loadHistorical) return;
    setSynthLoading(true);
    try {
      const summary = await synthesizeEventHistory({
        subject: clusterList,
        headline: subjectLabel,
        historyItems,
        gdeltArticles,
        actors,
      });
      setAiSummary(summary);
    } finally {
      setSynthLoading(false);
    }
  }, [actors, clusterList, gdeltArticles, historyItems, loadHistorical, primaryCluster, subjectLabel]);

  return {
    searchTerms,
    liveGraph,
    historicalGraph,
    graph,
    historyItems,
    gdeltArticles,
    actors,
    aiSummary,
    loading,
    synthLoading,
    timelineRows,
    runHistorySynthesis,
  };
}