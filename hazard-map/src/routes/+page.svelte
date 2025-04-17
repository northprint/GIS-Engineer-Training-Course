<script lang="ts">
	import { MapLibre, RasterTileSource, RasterLayer } from 'svelte-maplibre-gl';
	import type { StyleSpecification } from 'maplibre-gl';
	import HazardControlPanel from '$lib/HazardControlPanel.svelte';

	let map = $state<maplibregl.Map | undefined>(undefined);

	const mapStyle: StyleSpecification = {
		version: 8,
		sources: {
			osm: {
				type: 'raster',
				tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
				maxzoom: 19,
				tileSize: 256,
				attribution:
					'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
			}
		},
		layers: [
			{
				id: 'osm-layer',
				type: 'raster',
				source: 'osm'
			}
		]
	};

	const hazardTiles = [
		{
			id: 'hazard_flood',
			name: '洪水浸水想定区域',
			tile: {
				type: 'raster',
				tiles: ['https://disaportal.gsi.go.jp/raster/01_flood_l2_shinsuishin/{z}/{x}/{y}.png'],
				minzoom: 2,
				maxzoom: 17,
				tileSize: 256,
				attribution:
					'<a href="https://diaspotal.gsi.go.jp/hazardmap/copyright/opendata.html">ハザードマップポータルサイト</a>'
			}
		},
		{
			id: 'hazard_hightide',
			name: '高潮浸水想定区域',
			tile: {
				type: 'raster',
				tiles: [
					'https://disaportaldata.gsi.go.jp/raster/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png'
				],
				minzoom: 2,
				maxzoom: 17,
				tileSize: 256,
				attribution:
					'<a href="https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html">ハザードマップポータルサイト</a>'
			}
		},
		{
			id: 'hazard_tsunami',
			name: '津波浸水想定区域',
			tile: {
				type: 'raster',
				tiles: [
					'https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png'
				],
				minzoom: 2,
				maxzoom: 17,
				tileSize: 256,
				attribution:
					'<a href="https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html">ハザードマップポータルサイト</a>'
			}
		},
		{
			id: 'hazard_doseki',
			name: '土石流警戒区域',
			tile: {
				type: 'raster',
				tiles: ['https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png'],
				minzoom: 2,
				maxzoom: 17,
				tileSize: 256,
				attribution:
					'<a href="https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html">ハザードマップポータルサイト</a>'
			}
		},
		{
			id: 'hazard_kyukeisha',
			name: '急傾斜地警戒区域',
			tile: {
				type: 'raster',
				tiles: ['https://disaportaldata.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png'],
				minzoom: 2,
				maxzoom: 17,
				tileSize: 256,
				attribution:
					'<a href="https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html">ハザードマップポータルサイト</a>'
			}
		},
		{
			id: 'hazard_jisuberi',
			name: '地滑り警戒区域',
			tile: {
				type: 'raster',
				tiles: ['https://disaportaldata.gsi.go.jp/raster/05_jisuberikeikaikuiki/{z}/{x}/{y}.png'],
				minzoom: 2,
				maxzoom: 17,
				tileSize: 256,
				attribution:
					'<a href="https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html">ハザードマップポータルサイト</a>'
			}
		}
	];

	// HazardControl型の定義を追加
	type HazardControl = { id: string; name: string; visible: boolean; opacity: number };
	let hazardControls = $state<HazardControl[]>(
		hazardTiles.map((tile) => ({ id: tile.id, name: tile.name, visible: true, opacity: 1 }))
	);
</script>

<div class="fixed inset-0 h-screen w-screen">
	<!-- 地図コンポーネント -->
	<MapLibre bind:map zoom={5} center={[138, 37]} class="h-full w-full" style={mapStyle}>
		{#each hazardTiles as { id, tile }}
			{#if hazardControls.find((control) => control.id === id)?.visible}
				<RasterTileSource {id} {...tile}>
					<RasterLayer
						{id}
						source={id}
						paint={{
							'raster-opacity': hazardControls.find((control) => control.id === id)?.opacity ?? 1
						}}
					/>
				</RasterTileSource>
			{/if}
		{/each}
	</MapLibre>

	<!-- コントロールパネル（画面右上に固定） -->
	<div class="absolute right-4 top-4 z-10">
		<HazardControlPanel bind:hazardControls />
	</div>
</div>
