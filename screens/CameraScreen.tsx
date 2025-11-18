import React, { useState, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert } from 'react-native';
import { Camera, CameraView } from 'expo-camera';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { CameraScreenNavigationProp } from '../types/navigation';

// JunkVizion Pricing Model (based on real Penske 16ft truck rates)
// Truck Specifications: 16ft x 7.5ft x 7.5ft = ~900 cubic feet total
// Base: $1500 for full truck load (16ft Penske truck)
// Split: $375 per quarter-section (~225 cubic feet each, assumes 4 equal sections)
//
// Volume Calculations (refined for accuracy):
// - Small section: ~225 cu ft ($375)
// - Medium section: ~450 cu ft ($750)
// - Large section: ~900 cu ft ($1500)
//
// All prices exclude:
// - Surcharges for heavy/special items
// - $200 per ton environmental fees
// - Fuel surcharge (varies by location)

const BASE_PRICING = {
  // Small Items (25% truck volume = ~225 cu ft)
  small_items: {
    chair: { volumeCuFt: 15, spaceRequired: 0.25 }, // Chair ≈ 15 cu ft, 25% space
    microwave: { volumeCuFt: 3, spaceRequired: 0.25 },  // Microwave ≈ 3 cu ft
    television: { volumeCuFt: 10, spaceRequired: 0.25 }, // TV ≈ 10 cu ft
    computer: { volumeCuFt: 5, spaceRequired: 0.25 },
    box: { volumeCuFt: 5, spaceRequired: 0.25 }, // Standard moving box
    trash_can: { volumeCuFt: 5, spaceRequired: 0.25 },
  },

  // Medium Items (50% truck volume = ~450 cu ft)
  medium_items: {
    table: { volumeCuFt: 50, spaceRequired: 0.5 }, // Dining table ≈ 50 cu ft
    washing_machine: { volumeCuFt: 25, spaceRequired: 0.5 },
    bed_frame: { volumeCuFt: 35, spaceRequired: 0.5 },
  },

  // Large Items (100% truck volume = ~900 cu ft)
  large_items: {
    couch: { volumeCuFt: 150, spaceRequired: 1.0 }, // Sofa ≈ 150 cu ft
    refrigerator: { volumeCuFt: 85, spaceRequired: 1.0 }, // Fridge ≈ 85 cu ft
    bed_complete: { volumeCuFt: 120, spaceRequired: 1.0 }, // Bed + mattress ≈ 120 cu ft
  }
};

// Truck specifications for reference
const TRUCK_SPECS = {
  lengthFt: 16,
  widthFt: 7.5,
  heightFt: 7.5,
  totalVolumeCuFt: 16 * 7.5 * 7.5, // ~900 cu ft
  sectionVolumeCuFt: (16 * 7.5 * 7.5) / 4, // ~225 cu ft per section
  weightCapacityLbs: 6000, // Approximately for pricing reference
};

const SURCHARGE_ITEMS = {
  // Heavy/disposal surcharges ($200-$500 additional per item)
  heavy_appliances: {
    refrigerator: { surcharge: 200 },
    washing_machine: { surcharge: 200 },
    air_conditioner: { surcharge: 300 },
  },

  bulky_furniture: {
    couch: { surcharge: 150 },
    mattress: { surcharge: 100 },
    boxspring: { surcharge: 100 },
    bed_complete: { surcharge: 200 }, // Combined surcharge
  },

  hazardous: {
    // Paint, chemicals, cleaning products
    hazardous_waste: { surcharge: 300 },
  }
};

const ENVIRONMENTAL_FEES = {
  // $200 per ton, estimated at ~2000lbs per section
  per_ton: 200,
  estimated_tons_per_section: 1, // ~2000lbs
};

// Category mapping from COCO-SSD to junk items
const CATEGORY_MAPPING = {
  chair: 'chair',
  couch: 'couch',
  sofa: 'couch',
  bed: 'bed',
  table: 'table',
  refrigerator: 'refrigerator',
  microwave: 'microwave',
  television: 'television',
  laptop: 'computer',
  computer: 'computer',
};

type CameraScreenProps = {
  navigation: CameraScreenNavigationProp;
};

// Calculate total estimate using JunkVizion pricing model
const calculateEstimateTotal = (detections: any[]) => {
  let totalSpaceRequired = 0; // Accumulate space (0-4 sections)
  let baseCost = 0;
  let surchargeCost = 0;
  let environmentalCost = 0;

  let detectedItems: { [key: string]: { count: number, spaceUsed: number, surcharges: number } } = {};

  detections.filter((pred: any) => pred.score > 0.4).forEach((pred: any) => {
    const item = CATEGORY_MAPPING[pred.class as keyof typeof CATEGORY_MAPPING];
    if (item) {

      // Find item in pricing database and calculate space/costs
      let itemSpace = 0;
      let itemSurcharges = 0;

      // Check all categories for the item
      Object.values(BASE_PRICING).forEach(category => {
        const categoryGroup = category as any;
        if (categoryGroup[item]) {
          itemSpace = categoryGroup[item].spaceRequired;
        }
      });

      // Check for surcharges
      Object.values(SURCHARGE_ITEMS).forEach(category => {
        const surchargeGroup = category as any;
        if (surchargeGroup[item]) {
          itemSurcharges = surchargeGroup[item].surcharge;
        }
      });

      // Accumulate totals
      totalSpaceRequired += itemSpace;
      surchargeCost += itemSurcharges;

      // Track individual items
      const itemKey = `${item} (${Math.round(pred.score * 100)}%)`;
      if (!detectedItems[itemKey]) {
        detectedItems[itemKey] = {
          count: 0,
          spaceUsed: 0,
          surcharges: 0
        };
      }
      detectedItems[itemKey].count += 1;
      detectedItems[itemKey].spaceUsed += itemSpace;
      detectedItems[itemKey].surcharges += itemSurcharges;
    }
  });

  // Calculate base cost: $375 per quarter section (up to 4 sections = $1500)
  // Round up to next quarter for partial sections
  const sectionsUsed = Math.ceil(totalSpaceRequired * 4); // Convert to quarters
  baseCost = Math.min(sectionsUsed * 375, 4 * 375); // Cap at full truck

  // Calculate environmental fees: $200 per ton, estimate 1 ton per section
  const estimatedTons = Math.ceil(totalSpaceRequired);
  environmentalCost = estimatedTons * ENVIRONMENTAL_FEES.per_ton;

  // Total cost
  const totalCost = baseCost + surchargeCost + environmentalCost;

  return {
    totalCost,
    breakdown: {
      sectionsUsed: Math.min(sectionsUsed, 4),
      baseCost,
      surchargeCost,
      environmentalCost,
      detectedItems
    }
  };
};

export default function CameraScreen({ navigation }: CameraScreenProps) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [isProcessing, setIsProcessing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  React.useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');

      // Load TensorFlow.js model
      await tf.ready();
      console.log('TensorFlow.js loaded');
    })();
  }, []);

  const processImageWithAI = async (imageUri: string) => {
    try {
      setIsProcessing(true);

      // Load COCO-SSD model
      const model = await cocoSsd.load();

      // Create image element from URI
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = imageUri;

      return new Promise<any[]>((resolve, reject) => {
        img.onload = async () => {
          try {
            const predictions = await model.detect(img);
            resolve(predictions);
          } catch (error) {
            reject(error);
          }
        };
        img.onerror = () => reject(new Error('Failed to load image'));
      });
    } catch (error) {
      console.error('Error loading AI model:', error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  };

  const takePicture = async () => {
    if (cameraRef.current && !isProcessing) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.7,
          base64: false,
        });
        console.log('Photo taken:', photo.uri);

        // Process with AI
        const predictions = await processImageWithAI(photo.uri);
        console.log('AI predictions:', predictions);

        // Calculate pricing for detected items using JunkVizion model
        const pricingResult = calculateEstimateTotal(predictions);
        const { totalCost, breakdown } = pricingResult;

        // Build detailed estimate message
        const itemCount = Object.keys(breakdown.detectedItems).length;
        let estimateMessage = `🚛 Truck Space Used: ${breakdown.sectionsUsed}/4 sections ($${breakdown.baseCost})\n\n`;

        if (breakdown.surchargeCost > 0) {
          estimateMessage += `⚠️ Heavy Item Surcharges: $${breakdown.surchargeCost}\n\n`;
        }

        estimateMessage += `♻️ Environmental Fees: $${breakdown.environmentalCost}\n\n`;
        estimateMessage += `📦 Detected Items:\n`;

        const itemBreakdown = Object.entries(breakdown.detectedItems);
        itemBreakdown.forEach(([itemName, itemData]) => {
          estimateMessage += `${itemName} (${itemData.count}x)\n`;
        });

        estimateMessage += `\n💰 TOTAL ESTIMATE: $${totalCost}`;

        // Add disclaimer
        const disclaimer = "\n\n*Prices exclude fuel surcharges and may vary by location. Final quote provided upon inspection.";

        Alert.alert(
          'JunkVizion Estimate! 💰',
          estimateMessage + disclaimer,
          [{ text: 'Take Another Photo' }, { text: 'Done', onPress: () => navigation.goBack() }]
        );
      } catch (error) {
        console.error('Error processing photo:', error);
        Alert.alert('Processing Error', 'Failed to analyze image. Camera working, AI processing failed.');
      }
    }
  };

  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  if (hasPermission === null) {
    return <View style={styles.container}><Text>Requesting camera permission...</Text></View>;
  }
  if (hasPermission === false) {
    return <View style={styles.container}><Text>No access to camera</Text></View>;
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing={facing}
        ref={cameraRef}
        mode="picture"
      >
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={toggleCameraFacing}>
            <Text style={styles.text}>🔄</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
            <Text style={styles.captureText}>📸</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()}>
            <Text style={styles.text}>✖️</Text>
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  buttonContainer: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'transparent',
    margin: 64,
  },
  button: {
    flex: 1,
    alignSelf: 'flex-end',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 10,
    marginHorizontal: 10,
    borderRadius: 50,
  },
  captureButton: {
    flex: 0,
    alignSelf: 'flex-end',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: '#f39c12',
  },
  text: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  captureText: {
    fontSize: 24,
    color: 'black',
  },
});
