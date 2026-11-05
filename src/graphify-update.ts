// Process-local, version-gated adapter: delegate path semantics to native Graphify,
// but compute the same source-file rebase once per resolver instance, not per edge.
export const REBASE_CACHE = String.raw`
def install_rebase_cache(source_paths, counters):
    native = source_paths.rebase_preserved
    def rebase(self, item):
        source = item.get('source_file')
        if not isinstance(source, str):
            return native(self, item)
        cache = self.__dict__.setdefault('_diffslice_rebase_cache', {})
        if source not in cache:
            probe = {'source_file': source}
            native(self, probe)
            cache[source] = probe['source_file']
            counters['misses'] += 1
        else:
            counters['hits'] += 1
        item['source_file'] = cache[source]
    source_paths.rebase_preserved = rebase
`;

export const GRAPHIFY_UPDATE = REBASE_CACHE + String.raw`
import functools, importlib, importlib.metadata, json, pathlib, sys, time, warnings
started = time.perf_counter()
settings = json.load(sys.stdin)
version = importlib.metadata.version('graphifyy')
timings, depths, files = {}, {}, {}
counters = {'hits': 0, 'misses': 0}
root_switches = []
showwarning = warnings.showwarning
def warning(message, *args, **kwargs):
    if 'stat index switched from cache root' in str(message):
        root_switches.append(str(message))
    return showwarning(message, *args, **kwargs)
warnings.showwarning = warning

def measure(module, name, label):
    native = getattr(module, name, None)
    if native is None:
        return
    @functools.wraps(native)
    def call(*args, **kwargs):
        depth = depths.get(label, 0)
        depths[label] = depth + 1
        start = time.perf_counter()
        try:
            return native(*args, **kwargs)
        finally:
            depths[label] -= 1
            if depth == 0:
                timings[label] = timings.get(label, 0) + (time.perf_counter() - start) * 1000
    setattr(module, name, call)

adapted = version == '0.9.102' and not settings.get('native')
if version == '0.9.102':
    import graphify.watch as watch
if adapted:
    install_rebase_cache(watch._StoredSourcePaths, counters)
# Instrument only the pinned implementation. Other versions still run native update.
if version == '0.9.102':
    targets = {
        'detect': [('detect', 'detectMs')],
        'extract': [('extract', 'extractAndResolveMs'), ('_extract_sequential', 'parseMs')],
        'watch': [('_rebuild_code', 'rebuildMs'), ('_reconcile_existing_graph', 'reconcileMs'), ('_reconcile_graph_html', 'htmlMs')],
        'build': [('build_from_json', 'buildMs')],
        'cluster': [('cluster', 'clusterMs'), ('score_all', 'scoreMs')],
        'analyze': [('god_nodes', 'analysisMs'), ('surprising_connections', 'analysisMs'), ('suggest_questions', 'analysisMs')],
        'report': [('generate', 'reportMs')],
        'export': [('to_json', 'exportMs')],
    }
    for module_name, functions in targets.items():
        module = importlib.import_module('graphify.' + module_name)
        for name, label in functions:
            measure(module, name, label)
    import graphify.extract as extraction
    native_file = extraction._safe_extract_with_xaml_root
    def extract_file(extractor, path, *args, **kwargs):
        start = time.perf_counter()
        try:
            return native_file(extractor, path, *args, **kwargs)
        finally:
            row = files.setdefault(path.suffix.lower(), {'files': 0, 'ms': 0})
            row['files'] += 1
            row['ms'] += (time.perf_counter() - start) * 1000
    extraction._safe_extract_with_xaml_root = extract_file

from graphify.__main__ import main
imports_ms = (time.perf_counter() - started) * 1000
sys.argv = ['graphify', 'update', settings['snapshot']]
profiler = None
if settings.get('profile'):
    import cProfile
    profiler = cProfile.Profile()
    profiler.enable()
try:
    main()
finally:
    if profiler:
        profiler.disable()
        profiler.dump_stats(settings['profile'])
    timings['resolutionAndAssemblyMs'] = max(0, timings.get('extractAndResolveMs', 0) - timings.get('parseMs', 0))
    cache = sys.modules.get('graphify.cache')
    report = {
        'version': version, 'rebaseCache': {'enabled': adapted, **counters},
        'importsMs': imports_ms, 'totalMs': (time.perf_counter() - started) * 1000,
        'stages': timings, 'fileExtraction': files, 'profiled': profiler is not None,
        'statCacheRoot': str(getattr(cache, '_stat_index_root', None)),
        'statCacheAnchor': str(getattr(cache, '_stat_index_anchor', None)), 'statRootSwitches': root_switches,
    }
    try:
        pathlib.Path(settings['timings']).write_text(json.dumps(report, indent=2), encoding='utf-8')
    except OSError as error:
        print('DiffSlice: could not save Graphify diagnostics: ' + str(error), file=sys.stderr)
`;
