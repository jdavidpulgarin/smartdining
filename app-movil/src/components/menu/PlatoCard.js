import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { colores, radios, espaciado } from '../../theme';
import { formatearPrecio } from '../../utils/formato';
import { ETIQUETAS_MAP } from '../../constants/dieta';
import Badge from '../ui/Badge';

export default function PlatoCard({ plato, onPress }) {
  const {
    nombre,
    descripcion,
    precio,
    imagen,
    calorias,
    etiquetas = [],
    disponible = true,
  } = plato;

  return (
    <Pressable
      onPress={() => onPress?.(plato)}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.card,
        !disponible && styles.agotadoCard,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.imagenCont}>
        {imagen ? (
          <Image
            source={{ uri: imagen }}
            style={styles.imagen}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.sinImagen}>
            <Text style={styles.sinImagenTexto}>SIN FOTO</Text>
          </View>
        )}
        {!disponible && (
          <View style={styles.overlayAgotado}>
            <Text style={styles.overlayTexto}>AGOTADO</Text>
          </View>
        )}
      </View>

      <View style={styles.info}>
        <View style={styles.infoTop}>
          <View style={styles.tituloRow}>
            <Text style={styles.nombre} numberOfLines={1}>
              {nombre}
            </Text>
            {!disponible && <Badge variante="alerta">Agotado</Badge>}
          </View>
          {descripcion ? (
            <Text style={styles.descripcion} numberOfLines={2}>
              {descripcion}
            </Text>
          ) : null}

          {etiquetas.length > 0 && (
            <View style={styles.etiquetas}>
              {etiquetas.map((tag) => (
                <Badge key={tag}>
                  {ETIQUETAS_MAP[tag]?.label || tag.replace('_', ' ')}
                </Badge>
              ))}
            </View>
          )}
        </View>

        <View style={styles.pie}>
          <Text style={styles.precio}>{formatearPrecio(precio)}</Text>
          {calorias != null ? (
            <Text style={styles.calorias}>{calorias} kcal</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colores.superficie,
    borderRadius: radios.lg,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espaciado.md,
    gap: espaciado.md,
  },
  cardPressed: {
    borderColor: colores.primario,
  },
  agotadoCard: {
    opacity: 0.55,
  },
  imagenCont: {
    width: 96,
    height: 96,
    borderRadius: radios.md,
    overflow: 'hidden',
    backgroundColor: colores.superficie2,
    borderWidth: 1,
    borderColor: colores.borde,
    position: 'relative',
  },
  imagen: {
    width: '100%',
    height: '100%',
  },
  sinImagen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sinImagenTexto: {
    color: colores.textoTenue,
    fontSize: 10,
    fontWeight: '700',
  },
  overlayAgotado: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11, 11, 11, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayTexto: {
    color: colores.primarioTexto,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  info: {
    flex: 1,
    justifyContent: 'space-between',
    gap: espaciado.sm,
  },
  infoTop: {
    gap: 4,
  },
  tituloRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaciado.sm,
  },
  nombre: {
    flex: 1,
    color: colores.texto,
    fontSize: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  descripcion: {
    color: colores.textoSuave,
    fontSize: 12,
    lineHeight: 17,
  },
  etiquetas: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  pie: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  precio: {
    color: colores.texto,
    fontSize: 18,
    fontWeight: '800',
  },
  calorias: {
    color: colores.textoSuave,
    fontSize: 12,
    fontWeight: '600',
  },
});
