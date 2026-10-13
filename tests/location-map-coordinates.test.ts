import { describe, expect, it } from 'vitest'
import { baiduToWgs84, locationQueryBounds } from '../src/client/location-map-coordinates.js'
describe('Baidu location viewport coordinates', () => {
  it('matches the mobile inverse conversion for Beijing and leaves points outside its region unchanged', () => {
    const point = baiduToWgs84({lng:116.41662724378733,lat:39.922699552216216})
    expect(point.lng).toBeCloseTo(116.404, 4)
    expect(point.lat).toBeCloseTo(39.915, 4)
    expect(baiduToWgs84({lng:-122.4,lat:37.8})).toEqual({lng:-122.4,lat:37.8})
  })
  it('contains the converted corners and safely covers antimeridian views', () => {
    const bounds = locationQueryBounds({lng:116.4166,lat:39.9226},{lng:116.4168,lat:39.9228})
    expect(bounds.swLon).toBeLessThan(116.404);expect(bounds.neLon).toBeGreaterThan(116.404)
    expect(locationQueryBounds({lng:170,lat:-10},{lng:-170,lat:10})).toMatchObject({swLon:-180,neLon:180})
  })
})
