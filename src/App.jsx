import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  Dimensions, StatusBar, TextInput, ScrollView,
  PanResponder, Animated, Alert, ActivityIndicator,
} from 'react-native';
import TrackPlayer, {
  useTrackPlayerEvents, Event, State, useProgress,
  Capability, RepeatMode,
} from 'react-native-track-player';
import DocumentPicker from 'react-native-document-picker';
import LinearGradient from 'react-native-linear-gradient';

const { width } = Dimensions.get('window');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (s) => {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const parseLRC = (lrc) => {
  if (!lrc) return [];
  const re = /\[(\d+):(\d+)\.(\d+)\](.*)/;
  return lrc.split('\n')
    .map(line => { const m = line.match(re); return m ? { time: parseInt(m[1]) * 60 + parseFloat(m[2] + '.' + m[3]), text: m[4].trim() } : null; })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
};

// ─── Setup TrackPlayer ────────────────────────────────────────────────────────
async function setupPlayer() {
  await TrackPlayer.setupPlayer();
  await TrackPlayer.updateOptions({
    capabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious, Capability.SeekTo],
    compactCapabilities: [Capability.Play, Capability.Pause],
  });
}

// ─── Swipeable Row ────────────────────────────────────────────────────────────
function SwipeRow({ song, onPress, onSwipeLeft, onSwipeRight, isActive, isPlaying }) {
  const pan = useRef(new Animated.Value(0)).current;
  const pr = PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10,
    onPanResponderMove: (_, g) => pan.setValue(Math.max(-120, Math.min(120, g.dx))),
    onPanResponderRelease: (_, g) => {
      if (g.dx < -80) { onSwipeLeft && onSwipeLeft(); }
      else if (g.dx > 80) { onSwipeRight && onSwipeRight(); }
      Animated.spring(pan, { toValue: 0, useNativeDriver: true }).start();
    },
  });

  return (
    <View style={{ marginBottom: 6, borderRadius: 12, overflow: 'hidden' }}>
      <View style={[styles.swipeHint, { left: 0, backgroundColor: '#f7b731' }]}>
        <Text style={{ fontSize: 20 }}>★</Text>
      </View>
      <View style={[styles.swipeHint, { right: 0, backgroundColor: '#e74c3c' }]}>
        <Text style={{ fontSize: 20, color: '#fff' }}>✕</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX: pan }] }} {...pr.panHandlers}>
        <TouchableOpacity onPress={onPress} activeOpacity={0.8}
          style={[styles.songRow, isActive && styles.songRowActive]}>
          <View style={[styles.albumThumb, { backgroundColor: '#f7b731' }]}>
            <Text style={{ fontSize: 20 }}>♩</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.songTitle, isActive && { color: '#f7b731' }]} numberOfLines={1}>
              {song.title}
            </Text>
            <Text style={styles.songArtist} numberOfLines={1}>{song.artist || 'Desconhecido'}</Text>
          </View>
          {isActive && isPlaying && (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
              {[1, 0.6, 0.8].map((h, i) => (
                <View key={i} style={{ width: 3, height: h * 14, backgroundColor: '#f7b731', borderRadius: 2 }} />
              ))}
            </View>
          )}
          {song.favorite && <Text style={{ color: '#f7b731', fontSize: 14 }}>★</Text>}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ─── Lyrics Screen ────────────────────────────────────────────────────────────
function LyricsScreen({ lyrics, position, playing }) {
  const parsed = parseLRC(lyrics);
  const isLRC = parsed.length > 0;
  const scrollRef = useRef(null);
  const itemRefs = useRef({});

  let activeIdx = -1;
  if (isLRC) parsed.forEach((l, i) => { if (l.time <= position) activeIdx = i; });

  useEffect(() => {
    if (playing && itemRefs.current[activeIdx]) {
      itemRefs.current[activeIdx].measureLayout(scrollRef.current, (x, y) => {
        scrollRef.current?.scrollTo({ y: y - 150, animated: true });
      });
    }
  }, [activeIdx, playing]);

  if (!lyrics) return (
    <View style={styles.center}><Text style={{ color: '#555', fontSize: 14 }}>Sem letras disponíveis</Text></View>
  );

  if (!isLRC) return (
    <ScrollView style={{ padding: 16 }}>
      <Text style={{ color: '#ccc', lineHeight: 28, fontSize: 14 }}>{lyrics}</Text>
    </ScrollView>
  );

  return (
    <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      {parsed.map((line, i) => (
        <View key={i} ref={r => itemRefs.current[i] = r}>
          <Text style={{
            textAlign: 'center', paddingVertical: 8,
            fontSize: i === activeIdx ? 18 : 14,
            fontWeight: i === activeIdx ? '700' : '400',
            color: i === activeIdx ? '#f7b731' : i < activeIdx ? '#444' : '#777',
          }}>
            {line.text || '·'}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [ready, setReady] = useState(false);
  const [songs, setSongs] = useState([]);
  const [queue, setQueue] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState('library');
  const [search, setSearch] = useState('');
  const [lyrics, setLyrics] = useState(null);
  const [loadingLyrics, setLoadingLyrics] = useState(false);
  const [hiddenIds, setHiddenIds] = useState(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [recentlyPlayed, setRecentlyPlayed] = useState([]);
  const [playCounts, setPlayCounts] = useState({});
  const [favorites, setFavorites] = useState(new Set());
  const [recentlyAdded, setRecentlyAdded] = useState([]);
  const [repeat, setRepeat] = useState('none');
  const [shuffle, setShuffle] = useState(false);
  const [crossfadeActive, setCrossfadeActive] = useState(false);
  const lyricsCache = useRef({});
  const { position, duration } = useProgress();

  useEffect(() => { setupPlayer().then(() => setReady(true)); }, []);

  useTrackPlayerEvents([Event.PlaybackState, Event.PlaybackActiveTrackChanged], async (e) => {
    if (e.type === Event.PlaybackState) {
      setPlaying(e.state === State.Playing);
    }
    if (e.type === Event.PlaybackActiveTrackChanged) {
      const idx = await TrackPlayer.getActiveTrackIndex();
      setCurrentIdx(idx);
    }
  });

  useEffect(() => {
    if (!duration || duration === 0) return;
    if (duration - position <= 15 && !crossfadeActive) setCrossfadeActive(true);
    if (position < duration - 15 && crossfadeActive) setCrossfadeActive(false);
  }, [position, duration]);

  const currentSong = queue[currentIdx] ?? null;

  const fetchLyrics = useCallback(async (song) => {
    if (!song) return;
    const key = `${song.artist}::${song.title}`;
    if (lyricsCache.current[key] !== undefined) { setLyrics(lyricsCache.current[key]); return; }
    setLoadingLyrics(true);
    try {
      const r = await fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(song.artist || '')}&track_name=${encodeURIComponent(song.title || '')}`);
      if (r.ok) {
        const d = await r.json();
        const l = d.syncedLyrics || d.plainLyrics || null;
        lyricsCache.current[key] = l;
        setLyrics(l);
      } else { lyricsCache.current[key] = null; setLyrics(null); }
    } catch { setLyrics(null); }
    setLoadingLyrics(false);
  }, []);

  const pickFiles = async () => {
    try {
      const results = await DocumentPicker.pick({
        type: [DocumentPicker.types.audio],
        allowMultiSelection: true,
      });
      const newSongs = results.map(f => ({
        id: f.uri,
        url: f.uri,
        title: f.name.replace(/\.[^.]+$/, '').split(' - ').slice(-1)[0] || f.name,
        artist: f.name.replace(/\.[^.]+$/, '').split(' - ')[0] || 'Desconhecido',
        album: '',
        favorite: false,
      }));
      setSongs(prev => {
        const ids = new Set(prev.map(s => s.id));
        return [...prev, ...newSongs.filter(s => !ids.has(s.id))];
      });
      setRecentlyAdded(prev => [...newSongs.map(s => s.id), ...prev].slice(0, 50));
    } catch (e) {
      if (!DocumentPicker.isCancel(e)) Alert.alert('Erro', 'Não foi possível abrir ficheiros');
    }
  };

  const playSong = async (song, list) => {
    const tracks = (list || songs.filter(s => !hiddenIds.has(s.id))).map(s => ({
      id: s.id, url: s.url, title: s.title, artist: s.artist || 'Desconhecido',
    }));
    const idx = tracks.findIndex(t => t.id === song.id);
    await TrackPlayer.reset();
    await TrackPlayer.add(tracks);
    await TrackPlayer.skip(idx >= 0 ? idx : 0);
    await TrackPlayer.play();
    setQueue(list || songs.filter(s => !hiddenIds.has(s.id)));
    setCurrentIdx(idx >= 0 ? idx : 0);
    setLyrics(null);
    fetchLyrics(song);
    setRecentlyPlayed(prev => [song, ...prev.filter(s => s.id !== song.id)].slice(0, 30));
    setPlayCounts(prev => ({ ...prev, [song.id]: (prev[song.id] || 0) + 1 }));
    setTab('player');
  };

  const togglePlay = async () => {
    if (playing) await TrackPlayer.pause();
    else await TrackPlayer.play();
  };

  const skipNext = async () => { await TrackPlayer.skipToNext(); setCrossfadeActive(false); };
  const skipPrev = async () => {
    if (position > 3) await TrackPlayer.seekTo(0);
    else await TrackPlayer.skipToPrevious();
  };

  const toggleFav = (song) => {
    setFavorites(prev => {
      const n = new Set(prev);
      if (n.has(song.id)) n.delete(song.id); else n.add(song.id);
      return n;
    });
  };

  const toggleHide = (song) => {
    setHiddenIds(prev => {
      const n = new Set(prev);
      if (n.has(song.id)) n.delete(song.id); else n.add(song.id);
      return n;
    });
  };

  const cycleRepeat = async () => {
    if (repeat === 'none') { setRepeat('all'); await TrackPlayer.setRepeatMode(RepeatMode.Queue); }
    else if (repeat === 'all') { setRepeat('one'); await TrackPlayer.setRepeatMode(RepeatMode.Track); }
    else { setRepeat('none'); await TrackPlayer.setRepeatMode(RepeatMode.Off); }
  };

  const visible = songs.filter(s => showHidden ? hiddenIds.has(s.id) : !hiddenIds.has(s.id));
  const filtered = visible.filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    (s.artist || '').toLowerCase().includes(search.toLowerCase())
  );
  const mostPlayed = [...songs].sort((a, b) => (playCounts[b.id] || 0) - (playCounts[a.id] || 0));
  const favList = songs.filter(s => favorites.has(s.id));
  const recentAddedList = songs.filter(s => recentlyAdded.includes(s.id));

  const TABS = [
    { id: 'library', icon: '♫', label: 'Músicas' },
    { id: 'recent', icon: '⟳', label: 'Recentes' },
    { id: 'playlists', icon: '☰', label: 'Listas' },
    { id: 'player', icon: '▶', label: 'Player' },
    { id: 'lyrics', icon: '✎', label: 'Letras' },
  ];

  if (!ready) return (
    <LinearGradient colors={['#0a0a0f', '#141420']} style={styles.center}>
      <Text style={{ fontSize: 48 }}>♩</Text>
      <ActivityIndicator color='#f7b731' style={{ marginTop: 16 }} />
    </LinearGradient>
  );

  return (
    <LinearGradient colors={['#0a0a0f', '#0f0f1a']} style={{ flex: 1 }}>
      <StatusBar barStyle='light-content' backgroundColor='#0a0a0f' />

      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <LinearGradient colors={['#f7b731', '#e67e22']} style={styles.appIcon}>
            <Text style={{ fontSize: 22 }}>♩</Text>
          </LinearGradient>
          <View>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16, letterSpacing: 1 }}>NOTA</Text>
            <Text style={{ color: '#666', fontSize: 10 }}>Music Player</Text>
          </View>
        </View>
        <TouchableOpacity onPress={pickFiles} style={styles.addBtn}>
          <Text style={{ color: '#f7b731', fontWeight: '700', fontSize: 13 }}>+ Adicionar</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1, paddingBottom: currentSong ? 120 : 60 }}>

        {tab === 'library' && (
          <FlatList
            data={filtered}
            keyExtractor={i => i.id}
            contentContainerStyle={{ padding: 16 }}
            ListHeaderComponent={
              <View style={{ marginBottom: 12 }}>
                <TextInput value={search} onChangeText={setSearch}
                  placeholder='Pesquisar...' placeholderTextColor='#555'
                  style={styles.searchInput} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                  <Text style={{ color: '#666', fontSize: 12 }}>{filtered.length} músicas</Text>
                  <TouchableOpacity onPress={() => setShowHidden(h => !h)}>
                    <Text style={{ color: showHidden ? '#f7b731' : '#666', fontSize: 12 }}>
                      {showHidden ? 'Ver todas' : 'Ver ocultas'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            }
            ListEmptyComponent={
              <View style={[styles.center, { paddingTop: 60 }]}>
                <Text style={{ fontSize: 56, marginBottom: 12 }}>♩</Text>
                <Text style={{ color: '#444', fontSize: 15, fontWeight: '600' }}>Sem músicas</Text>
                <Text style={{ color: '#333', fontSize: 13, marginTop: 4 }}>Toca em "+ Adicionar" para começar</Text>
              </View>
            }
            renderItem={({ item }) => (
              <SwipeRow song={item} onPress={() => playSong(item)}
                onSwipeLeft={() => toggleHide(item)}
                onSwipeRight={() => toggleFav(item)}
                isActive={currentSong?.id === item.id} isPlaying={playing} />
            )}
          />
        )}

        {tab === 'recent' && (
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text style={styles.sectionTitle}>Mais Tocadas</Text>
            {mostPlayed.filter(s => playCounts[s.id]).map((song, i) => (
              <View key={song.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: '#555', width: 20, textAlign: 'right', fontSize: 12 }}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <SwipeRow song={song} onPress={() => playSong(song)}
                    onSwipeRight={() => toggleFav(song)}
                    isActive={currentSong?.id === song.id} isPlaying={playing} />
                </View>
                <Text style={{ color: '#f7b731', fontSize: 11, minWidth: 24 }}>{playCounts[song.id]}×</Text>
              </View>
            ))}
            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Tocadas Recentemente</Text>
            {recentlyPlayed.length === 0 && <Text style={{ color: '#444', fontSize: 13 }}>Nenhuma ainda</Text>}
            {recentlyPlayed.map(song => (
              <SwipeRow key={song.id + '-r'} song={song} onPress={() => playSong(song)}
                onSwipeRight={() => toggleFav(song)}
                isActive={currentSong?.id === song.id} isPlaying={playing} />
            ))}
          </ScrollView>
        )}

        {tab === 'playlists' && (
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text style={styles.sectionTitle}>★ Favoritos ({favList.length})</Text>
            {favList.length === 0 && <Text style={{ color: '#444', fontSize: 13, marginBottom: 16 }}>Desliza → numa música para favoritar</Text>}
            {favList.map(song => (
              <SwipeRow key={song.id + '-f'} song={song} onPress={() => playSong(song, favList)}
                onSwipeRight={() => toggleFav(song)}
                isActive={currentSong?.id === song.id} isPlaying={playing} />
            ))}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Adições Recentes ({recentAddedList.length})</Text>
            {recentAddedList.map(song => (
              <SwipeRow key={song.id + '-ra'} song={song} onPress={() => playSong(song)}
                onSwipeRight={() => toggleFav(song)}
                isActive={currentSong?.id === song.id} isPlaying={playing} />
            ))}
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Fila de Reprodução ({queue.length})</Text>
            <Text style={{ color: '#555', fontSize: 11, marginBottom: 8 }}>Desliza ← para remover · → para favoritar</Text>
            {queue.map((song, i) => (
              <SwipeRow key={song.id + '-q'} song={song}
                onPress={async () => { await TrackPlayer.skip(i); await TrackPlayer.play(); setCurrentIdx(i); setTab('player'); }}
                onSwipeLeft={() => { setQueue(q => q.filter((_, qi) => qi !== i)); TrackPlayer.remove(i); }}
                onSwipeRight={() => toggleFav(song)}
                isActive={i === currentIdx} isPlaying={playing} />
            ))}
          </ScrollView>
        )}

        {tab === 'player' && (
          <ScrollView contentContainerStyle={{ padding: 20, alignItems: 'center' }}>
            {!currentSong ? (
              <View style={[styles.center, { paddingTop: 80 }]}>
                <Text style={{ fontSize: 64 }}>♩</Text>
                <Text style={{ color: '#444', marginTop: 12 }}>Nenhuma música selecionada</Text>
              </View>
            ) : (
              <>
                <LinearGradient colors={['#f7b731', '#e67e22', '#c0392b']} style={styles.albumArt}>
                  <Text style={{ fontSize: 72 }}>♩</Text>
                </LinearGradient>
                <Text style={styles.playerTitle} numberOfLines={1}>{currentSong.title}</Text>
                <Text style={styles.playerArtist}>{currentSong.artist || 'Desconhecido'}</Text>
                <TouchableOpacity onPress={() => toggleFav(currentSong)}>
                  <Text style={{ fontSize: 28, color: favorites.has(currentSong.id) ? '#f7b731' : '#444', marginBottom: 16 }}>★</Text>
                </TouchableOpacity>
                {crossfadeActive && (
                  <View style={styles.crossfadeBadge}>
                    <Text style={{ color: '#f7b731', fontSize: 11 }}>⟳ Revebrear ativo</Text>
                  </View>
                )}
                <View style={{ width: '100%', marginBottom: 4 }}>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${duration ? (position / duration) * 100 : 0}%` }]} />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                    <Text style={{ color: '#666', fontSize: 11 }}>{fmt(position)}</Text>
                    <Text style={{ color: '#666', fontSize: 11 }}>{fmt(duration)}</Text>
                  </View>
                </View>
                <View style={styles.controls}>
                  <TouchableOpacity onPress={() => setShuffle(s => !s)}>
                    <Text style={{ fontSize: 22, color: shuffle ? '#f7b731' : '#555' }}>⇄</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={skipPrev}>
                    <Text style={{ fontSize: 32, color: '#fff' }}>⏮</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={togglePlay} style={styles.playBtn}>
                    <LinearGradient colors={['#f7b731', '#e67e22']} style={styles.playBtnGrad}>
                      <Text style={{ fontSize: 28, color: '#000' }}>{playing ? '⏸' : '▶'}</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={skipNext}>
                    <Text style={{ fontSize: 32, color: '#fff' }}>⏭</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={cycleRepeat}>
                    <Text style={{ fontSize: 22, color: repeat !== 'none' ? '#f7b731' : '#555' }}>
                      {repeat === 'one' ? '↺¹' : '↺'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={() => setTab('lyrics')} style={styles.lyricsBtn}>
                  <Text style={{ color: '#888', fontSize: 13 }}>
                    {loadingLyrics ? 'A carregar letras...' : lyrics ? 'Ver Letras ✎' : 'Sem letras'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        )}

        {tab === 'lyrics' && (
          <View style={{ flex: 1 }}>
            {currentSong && (
              <View style={{ padding: 16, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{currentSong.title}</Text>
                <Text style={{ color: '#666', fontSize: 12 }}>{currentSong.artist}</Text>
              </View>
            )}
            {loadingLyrics
              ? <View style={styles.center}><ActivityIndicator color='#f7b731' /><Text style={{ color: '#666', marginTop: 8 }}>A buscar letras...</Text></View>
              : <LyricsScreen lyrics={lyrics} position={position} playing={playing} />
            }
          </View>
        )}
      </View>

      {currentSong && tab !== 'player' && tab !== 'lyrics' && (
        <TouchableOpacity onPress={() => setTab('player')} style={styles.miniPlayer}>
          <LinearGradient colors={['#f7b731', '#e67e22']} style={styles.miniThumb}>
            <Text style={{ fontSize: 18 }}>♩</Text>
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={styles.miniTitle} numberOfLines={1}>{currentSong.title}</Text>
            <Text style={{ color: '#666', fontSize: 11 }}>{currentSong.artist}</Text>
          </View>
          <TouchableOpacity onPress={togglePlay}>
            <Text style={{ color: '#f7b731', fontSize: 26 }}>{playing ? '⏸' : '▶'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={skipNext} style={{ marginLeft: 12 }}>
            <Text style={{ color: '#fff', fontSize: 22 }}>⏭</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      <View style={styles.bottomNav}>
        {TABS.map(t => (
          <TouchableOpacity key={t.id} onPress={() => setTab(t.id)} style={styles.tabBtn}>
            <Text style={{ fontSize: 20, color: tab === t.id ? '#f7b731' : '#555' }}>{t.icon}</Text>
            <Text style={{ fontSize: 10, color: tab === t.id ? '#f7b731' : '#555', fontWeight: '600' }}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 48 },
  appIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  addBtn: { backgroundColor: 'rgba(247,183,49,0.15)', borderWidth: 1, borderColor: 'rgba(247,183,49,0.3)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  searchInput: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 10, color: '#fff', fontSize: 14 },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  swipeHint: { position: 'absolute', top: 0, bottom: 0, width: 80, alignItems: 'center', justifyContent: 'center' },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, borderLeftWidth: 3, borderLeftColor: 'transparent' },
  songRowActive: { backgroundColor: 'rgba(255,200,50,0.12)', borderLeftColor: '#f7b731' },
  albumThumb: { width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  songTitle: { color: '#fff', fontWeight: '600', fontSize: 14 },
  songArtist: { color: '#888', fontSize: 12, marginTop: 2 },
  albumArt: { width: 200, height: 200, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginVertical: 20 },
  playerTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 4, textAlign: 'center', width: '100%' },
  playerArtist: { color: '#888', fontSize: 14, marginBottom: 8 },
  crossfadeBadge: { backgroundColor: 'rgba(247,183,49,0.15)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, marginBottom: 12 },
  progressTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4 },
  progressFill: { height: '100%', backgroundColor: '#f7b731', borderRadius: 4 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 20, marginVertical: 16 },
  playBtn: { shadowColor: '#f7b731', shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  playBtnGrad: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  lyricsBtn: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, marginTop: 8 },
  miniPlayer: { position: 'absolute', bottom: 58, left: 16, right: 16, backgroundColor: 'rgba(20,20,32,0.97)', borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: 'rgba(247,183,49,0.2)' },
  miniThumb: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  miniTitle: { color: '#fff', fontWeight: '600', fontSize: 13 },
  bottomNav: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: 'rgba(10,10,15,0.97)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingVertical: 8, paddingBottom: 16 },
  tabBtn: { alignItems: 'center', gap: 3 },
});
