import requests


precios_url = 'https://publicacionexterna.azurewebsites.net/publicaciones/prices'
estaciones_url = 'https://publicacionexterna.azurewebsites.net/publicaciones/places'


response_precios = requests.get(precios_url)
with open('precios.xml', 'wb') as file:
    file.write(response_precios.content)


response_estaciones = requests.get(estaciones_url)
with open('estaciones.xml', 'wb') as file:
    file.write(response_estaciones.content)

