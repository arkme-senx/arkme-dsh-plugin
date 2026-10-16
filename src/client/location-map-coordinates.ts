/** Adapted from coordtransform_dart 1.0.4; see docs/location-coordinate-license.md.
 * Marker display uses Baidu's official converter. This inverse conversion is only
 * for the WGS84 viewport query, matching Flutter's location endpoint contract. */
import type { BaiduPoint } from './baidu-map.js'
import type { LocationBounds } from '../location-search.js'
const regions = [[79.4462,42.8899,96.33,49.2204],[109.6872,39.3742,135.0002,54.1415],[73.1246,29.5297,124.143255,42.8899],[82.9684,26.7186,97.0352,29.5297],[97.0253,20.414096,124.367395,29.5297],[107.975793,17.871542,111.744104,20.414096]]
const excluded = [[119.921265,21.785006,122.497559,25.398623],[101.8652,20.0988,106.665,22.284],[106.4525,20.4878,108.051,21.5422],[109.0323,50.3257,119.127,55.8175],[127.4568,49.5574,137.0227,55.8175],[131.2662,42.5692,137.0227,44.8922],[73.1246,29.5297,77.948114,35.398637]]
export function baiduToWgs84(point: BaiduPoint): BaiduPoint {
  const contains = ([west, south, east, north]: number[]) => point.lng >= west! && point.lng <= east! && point.lat >= south! && point.lat <= north!
  if (!regions.some(contains) || excluded.some(contains)) return point
  const pi = Math.PI, xPi = pi * 3000 / 180
  const x = point.lng - .0065, y = point.lat - .006
  const radius = Math.hypot(x,y) - .00002 * Math.sin(y*xPi)
  const angle = Math.atan2(y,x) - .000003 * Math.cos(x*xPi)
  const lng = radius*Math.cos(angle), lat = radius*Math.sin(angle)
  const dx = lng-105, dy = lat-35
  const wave = (20*Math.sin(6*dx*pi)+20*Math.sin(2*dx*pi))*2/3
  let dlat = -100+2*dx+3*dy+.2*dy*dy+.1*dx*dy+.2*Math.sqrt(Math.abs(dx))+wave
  dlat += (20*Math.sin(dy*pi)+40*Math.sin(dy/3*pi))*2/3+(160*Math.sin(dy/12*pi)+320*Math.sin(dy*pi/30))*2/3
  let dlng = 300+dx+2*dy+.1*dx*dx+.1*dx*dy+.1*Math.sqrt(Math.abs(dx))+wave
  dlng += (20*Math.sin(dx*pi)+40*Math.sin(dx/3*pi))*2/3+(150*Math.sin(dx/12*pi)+300*Math.sin(dx/30*pi))*2/3
  const rad = lat/180*pi, eccentricity = .00669342162296594323, axis = 6378245
  const magic = 1-eccentricity*Math.sin(rad)**2, root = Math.sqrt(magic)
  dlat = dlat*180/((axis*(1-eccentricity))/(magic*root)*pi)
  dlng = dlng*180/(axis/root*Math.cos(rad)*pi)
  return { lng: lng-dlng, lat: lat-dlat }
}
export function locationQueryBounds(sw: BaiduPoint, ne: BaiduPoint): LocationBounds {
  const points = [sw, ne, {lng:sw.lng,lat:ne.lat}, {lng:ne.lng,lat:sw.lat}].map(baiduToWgs84)
  // A small margin covers inverse-conversion rounding at the viewport edge.
  return { swLat: Math.max(-85,Math.min(...points.map(p=>p.lat))-.0002), neLat: Math.min(85,Math.max(...points.map(p=>p.lat))+.0002),
    swLon: sw.lng >= ne.lng ? -180 : Math.max(-180,Math.min(...points.map(p=>p.lng))-.0002),
    neLon: sw.lng >= ne.lng ? 180 : Math.min(180,Math.max(...points.map(p=>p.lng))+.0002) }
}
