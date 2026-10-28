import { describe, expect, it } from 'vitest'
import { baiduToWgs84, locationQueryBounds } from '../src/client/location-map-coordinates.js'
import { locationViewportParts, worldLocationViewport } from '../src/location-search.js'
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
    expect(locationQueryBounds({lng:170,lat:-10},{lng:-170,lat:10})).toMatchObject({swLon:169.9998,neLon:-169.9998})
    expect(locationQueryBounds({lng:170,lat:-10},{lng:190,lat:10})).toMatchObject({swLon:169.9998,neLon:-169.9998})
    expect(locationQueryBounds({lng:350,lat:-10},{lng:370,lat:10})).toMatchObject({swLon:-10.0002,neLon:10.0002})
    expect(locationQueryBounds({lng:-180,lat:-10},{lng:180,lat:10})).toMatchObject({swLon:-180,neLon:180})
  })
  it('queries wide and wrapped views with disjoint bounded parts without losing the zero meridian',()=>{
    const world = locationViewportParts(worldLocationViewport)
    expect(world).toHaveLength(2)
    expect(world[0]!.bounds).toMatchObject({swLon:-180,neLon:-Number.MIN_VALUE})
    expect(world[1]!.bounds).toMatchObject({swLon:0,neLon:180})
    const wrapped = locationViewportParts({bounds:{swLat:-20,neLat:30,swLon:170,neLon:-170},zoom:3})
    expect(wrapped.map(part=>[part.bounds.swLon,part.bounds.neLon])).toEqual([[170,180],[-180,-170]])
    const broad = locationViewportParts({bounds:{swLat:-20,neLat:30,swLon:10,neLon:5},zoom:4})
    expect(broad).toHaveLength(3)
    expect([...world,...wrapped,...broad].every(part=>part.bounds.neLon-part.bounds.swLon<=180 && part.bounds.neLon>part.bounds.swLon)).toBe(true)
    const local = {bounds:{swLat:5,neLat:60,swLon:75,neLon:155},zoom:4}
    expect(locationViewportParts(local)).toEqual([local])
  })
})
