import type { BaiduMapStyle } from './baidu-map.js'

/** JSAPI 4.0 setMapStyle JSON; source pins keep their original semantic colors.
 * https://lbs.baidu.com/docs/jsapi?title=jsapi4/guide/map/style */
export const darkLocationMapStyle: BaiduMapStyle['styleJson'] = [
  { featureType: 'all', elementType: 'geometry', stylers: { color: '#262b33ff' } },
  { featureType: 'all', elementType: 'geometry.stroke', stylers: { color: '#3d4550ff' } },
  { featureType: 'land', elementType: 'geometry', stylers: { color: '#1c2027ff' } },
  { featureType: 'water', elementType: 'geometry', stylers: { color: '#172b3bff' } },
  { featureType: 'green', elementType: 'geometry', stylers: { color: '#1e302aff' } },
  { featureType: 'building', elementType: 'geometry', stylers: { color: '#2a3039ff' } },
  { featureType: 'road', elementType: 'geometry', stylers: { color: '#3b424dff' } },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: { color: '#282e37ff' } },
  { featureType: 'highway', elementType: 'geometry.fill', stylers: { color: '#66553aff' } },
  { featureType: 'highway', elementType: 'geometry.stroke', stylers: { color: '#332e27ff' } },
  { featureType: 'arterial', elementType: 'geometry.fill', stylers: { color: '#414955ff' } },
  { featureType: 'arterial', elementType: 'geometry.stroke', stylers: { color: '#2b323bff' } },
  { featureType: 'local', elementType: 'geometry.fill', stylers: { color: '#323a45ff' } },
  { featureType: 'railway', elementType: 'geometry', stylers: { color: '#555e6cff' } },
  { featureType: 'boundary', elementType: 'geometry', stylers: { color: '#586374ff' } },
  { featureType: 'all', elementType: 'labels.text.fill', stylers: { color: '#b6c1cfff' } },
  { featureType: 'all', elementType: 'labels.text.stroke', stylers: { color: '#1c2027ff' } },
]
